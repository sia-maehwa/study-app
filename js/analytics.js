/* 학습노트 — 과목별 학습 분석
   기존 localStorage 기록만 읽어 계산합니다. 별도의 분석 기록이나 데이터 마이그레이션은 만들지 않습니다. */
(function (global) {
  'use strict';

  var KEYS = {
    conceptStats: 'socmul_stats_v1',
    conceptWrong: 'socmul_wrong_v1',
    examHistory: 'socmul_exam_hist_v1',
    examAttempts: 'study_exam_attempts_v1'
  };

  function number(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : (fallback || 0);
  }

  function readJSON(key, fallback) {
    try {
      if (global.Store && typeof global.Store.getJSON === 'function') {
        return global.Store.getJSON(key, fallback);
      }
    } catch (err) {}
    return fallback;
  }

  function courseStorageKey(courseId, key) {
    /* Keep the original Social & Culture keys readable without migration. */
    return courseId === 'social-culture'
      ? key
      : 'study_course_' + encodeURIComponent(courseId) + '_' + key;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function courseMatches(record, courseId) {
    return (record.courseId || 'social-culture') === courseId;
  }

  function hasResponse(value) {
    if (value === null || value === undefined || value === '') return false;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }

  function normalizeExams(courseId) {
    var registry = global.StudyCourseRegistry;
    var engine = global.AssessmentEngine;
    var data = registry && registry.getAssessmentData(courseId);
    if (!data) return [];
    var raw = (data.officialExams || []).concat(data.practiceExams || []);
    if (!engine || typeof engine.normalizeAssessment !== 'function') return raw;
    return raw.map(function (assessment) {
      var source = {};
      Object.keys(assessment).forEach(function (key) { source[key] = assessment[key]; });
      var isPractice = String(source.id || '').indexOf('predict_') === 0 ||
        source.assessmentCategory === 'practice' ||
        ['self-produced-practice', 'practice', 'quiz', 'homework'].indexOf(source.assessmentType || source.kind) !== -1;
      if (courseId === 'social-culture' && !source.questionImagePattern) {
        source.questionImagePattern = 'assets/exams/{assessmentId}/q{number}.jpg';
      }
      return engine.normalizeAssessment(source, {
        courseId: courseId,
        assessmentType: source.assessmentType || (isPractice ? 'self-produced-practice' : 'official-exam')
      });
    });
  }

  function calculate(options) {
    options = options || {};
    var courseId = options.courseId || 'social-culture';
    var units = Array.isArray(options.units) ? options.units : [];
    var exams = Array.isArray(options.exams) ? options.exams : [];
    var history = Array.isArray(options.history) ? options.history.filter(function (record) {
      return record && courseMatches(record, courseId);
    }) : [];
    var snapshots = options.snapshots && typeof options.snapshots === 'object' ? options.snapshots : {};
    var conceptStats = options.conceptStats && typeof options.conceptStats === 'object' ? options.conceptStats : {};
    var conceptWrong = options.conceptWrong && typeof options.conceptWrong === 'object' ? options.conceptWrong : {};
    var conceptQuestions = Array.isArray(options.conceptQuestions) ? options.conceptQuestions : [];
    var engine = options.engine || null;
    var examById = {};
    exams.forEach(function (exam) { if (exam && exam.id) examById[exam.id] = exam; });

    var sortedHistory = history.slice().sort(function (a, b) {
      return number(a.at) - number(b.at);
    });
    var detailedAttempts = 0;
    var pendingManualAttempts = 0;
    var includedQuestionAttempts = 0;
    var gradedQuestionAttempts = 0;
    var correctQuestionAttempts = 0;
    var unitQuestionCoverage = 0;
    var assessmentQuestionCount = 0;
    var questionStats = {};

    exams.forEach(function (exam) {
      (exam.questions || []).forEach(function (question) {
        assessmentQuestionCount += 1;
        if (question.unitId !== undefined || question.unit !== undefined) unitQuestionCoverage += 1;
      });
    });

    sortedHistory.forEach(function (record) {
      if (number(record.pendingManual) > 0) pendingManualAttempts += 1;
      if (!record.attemptId) return;
      var recordCourseId = record.courseId || 'social-culture';
      var snapshotKey = recordCourseId + ':' + record.id + ':' + record.attemptId;
      var snapshot = snapshots[snapshotKey];
      var exam = examById[record.id];
      if (!snapshot || !exam || !Array.isArray(snapshot.answers)) return;
      detailedAttempts += 1;

      (exam.questions || []).forEach(function (question, index) {
        if (snapshot.excludedDiagram && question.d) return;
        includedQuestionAttempts += 1;
        var unitId = question.unitId !== undefined ? question.unitId : question.unit;
        var questionKey = String(exam.id) + ':' + String(question.number || question.n || index + 1);
        var item = questionStats[questionKey] || {
          examId: exam.id,
          examLabel: exam.label || exam.title || exam.id,
          questionNumber: question.number || question.n || index + 1,
          attempts: 0,
          correctCount: 0,
          incorrectCount: 0,
          unansweredCount: 0,
          partialCount: 0,
          pendingManualCount: 0,
          lastAt: 0,
          lastStatus: '',
          unitId: unitId
        };
        item.attempts += 1;
        var response = snapshot.answers[index];
        var grade = snapshot.manualGrades && snapshot.manualGrades[index];
        var evaluation;
        if (engine && typeof engine.evaluateResponse === 'function') {
          evaluation = engine.evaluateResponse(question, response, grade);
        } else {
          var correctFallback = hasResponse(response) && response === question.answerKey;
          evaluation = { status: !hasResponse(response) ? 'unanswered' : (correctFallback ? 'correct' : 'incorrect') };
        }

        if (evaluation.status === 'correct' ||
            (evaluation.status === 'graded-manual' && evaluation.isCorrect === true)) {
          item.correctCount += 1;
          gradedQuestionAttempts += 1;
          correctQuestionAttempts += 1;
          item.lastStatus = 'correct';
        } else if (evaluation.status === 'incorrect' ||
            (evaluation.status === 'graded-manual' && evaluation.isCorrect === false)) {
          item.incorrectCount += 1;
          if (evaluation.status === 'graded-manual') item.partialCount += 1;
          gradedQuestionAttempts += 1;
          item.lastStatus = evaluation.status === 'graded-manual' ? 'partial' : 'incorrect';
        } else if (evaluation.status === 'unanswered') {
          item.unansweredCount += 1;
          item.lastStatus = 'unanswered';
        } else if (evaluation.status === 'pending-manual') {
          item.pendingManualCount += 1;
          item.lastStatus = 'pending';
        } else {
          item.lastStatus = evaluation.status || 'unknown';
        }
        item.lastAt = number(record.at, number(snapshot.submittedAt, item.lastAt));
        if (unitId !== undefined && unitId !== null && unitId !== '') {
          item.unitId = unitId;
        }
        questionStats[questionKey] = item;
      });
    });

    var scorePoints = sortedHistory.map(function (record) {
      var max = number(record.max);
      var score = number(record.score);
      var exam = examById[record.id];
      return {
        id: record.id,
        label: record.label || (exam && (exam.label || exam.title)) || record.id || '평가',
        score: score,
        max: max,
        percent: max > 0 ? Math.max(0, Math.min(100, score / max * 100)) : null,
        at: number(record.at),
        pendingManual: number(record.pendingManual),
        attemptId: record.attemptId || null
      };
    }).filter(function (point) { return point.percent !== null; });

    var percentages = scorePoints.map(function (point) { return point.percent; });
    var averagePercent = percentages.length
      ? percentages.reduce(function (sum, value) { return sum + value; }, 0) / percentages.length
      : null;
    var bestPercent = percentages.length ? Math.max.apply(Math, percentages) : null;
    var latestScore = scorePoints.length ? scorePoints[scorePoints.length - 1] : null;

    var statsByUnit = conceptStats.byUnit && typeof conceptStats.byUnit === 'object'
      ? conceptStats.byUnit : {};
    var unitMetrics = units.map(function (unit) {
      var stat = statsByUnit[String(unit.id)] || statsByUnit[unit.id] || {};
      var total = number(stat.total);
      var correct = number(stat.correct);
      return {
        id: unit.id,
        name: unit.name || ('단원 ' + unit.id),
        questionCount: total,
        correctCount: correct,
        accuracy: total > 0 ? Math.round(correct / total * 100) : null
      };
    });

    var questionById = {};
    conceptQuestions.forEach(function (question) { questionById[String(question.id)] = question; });
    var conceptWeakness = Object.keys(conceptWrong).map(function (id) {
      var question = questionById[id];
      if (!question) return null;
      return {
        questionId: question.id,
        topic: question.t || ('문항 ' + id),
        unitName: (units.filter(function (unit) { return String(unit.id) === String(question.u); })[0] || {}).name || '',
        wrongCount: Math.max(0, number(conceptWrong[id]))
      };
    }).filter(Boolean).sort(function (a, b) {
      return b.wrongCount - a.wrongCount || a.questionId - b.questionId;
    });

    var examQuestionWeakness = Object.keys(questionStats).map(function (key) {
      return questionStats[key];
    }).filter(function (item) {
      return item.incorrectCount > 0;
    }).sort(function (a, b) {
      return b.incorrectCount - a.incorrectCount ||
        b.lastAt - a.lastAt ||
        a.questionNumber - b.questionNumber;
    });

    var assessmentUnitStats = {};
    Object.keys(questionStats).forEach(function (key) {
      var item = questionStats[key];
      if (item.unitId === undefined || item.unitId === null || item.unitId === '') return;
      var stat = assessmentUnitStats[String(item.unitId)] || { unitId: item.unitId, attempts: 0, correct: 0, incorrect: 0 };
      stat.attempts += item.attempts;
      stat.correct += item.correctCount;
      stat.incorrect += item.incorrectCount;
      assessmentUnitStats[String(item.unitId)] = stat;
    });

    return {
      courseId: courseId,
      totalExamAttempts: sortedHistory.length,
      detailedAttempts: detailedAttempts,
      scoreOnlyAttempts: Math.max(0, sortedHistory.length - detailedAttempts),
      pendingManualAttempts: pendingManualAttempts,
      averagePercent: averagePercent,
      bestPercent: bestPercent,
      latestScore: latestScore,
      scoreTrend: scorePoints.slice(-8),
      conceptTotal: number(conceptStats.total),
      conceptCorrect: number(conceptStats.correct),
      conceptAccuracy: number(conceptStats.total) > 0
        ? Math.round(number(conceptStats.correct) / number(conceptStats.total) * 100)
        : null,
      unitMetrics: unitMetrics,
      conceptWeakness: conceptWeakness.slice(0, 8),
      examQuestionWeakness: examQuestionWeakness.slice(0, 8),
      includedQuestionAttempts: includedQuestionAttempts,
      gradedQuestionAttempts: gradedQuestionAttempts,
      correctQuestionAttempts: correctQuestionAttempts,
      assessmentQuestionCount: assessmentQuestionCount,
      unitQuestionCoverage: unitQuestionCoverage,
      assessmentUnitStats: Object.keys(assessmentUnitStats).map(function (id) { return assessmentUnitStats[id]; })
    };
  }

  function analyze(courseId) {
    courseId = courseId || 'social-culture';
    var registry = global.StudyCourseRegistry;
    var content = registry && registry.getContent(courseId);
    var exams = normalizeExams(courseId);
    return calculate({
      courseId: courseId,
      units: content && content.units ? content.units : [],
      conceptQuestions: content && content.questions ? content.questions : [],
      exams: exams,
      history: readJSON(KEYS.examHistory, []),
      snapshots: readJSON(KEYS.examAttempts, {}),
      conceptStats: readJSON(courseStorageKey(courseId, KEYS.conceptStats), { byUnit: {}, total: 0, correct: 0 }),
      conceptWrong: readJSON(courseStorageKey(courseId, KEYS.conceptWrong), {}),
      engine: global.AssessmentEngine
    });
  }

  function percentLabel(value) {
    return value === null || value === undefined ? '—' : Math.round(value) + '%';
  }

  function render(view, courseId) {
    if (!view) return;
    var report = analyze(courseId);
    var course = global.StudyCourseRegistry && global.StudyCourseRegistry.get(courseId || 'social-culture');
    var courseName = course ? course.title : '선택 과목';
    var html = '<div class="hero analytics-hero">' +
      '<span class="hero-kicker">LEARNING ANALYTICS</span>' +
      '<h1>학습 분석</h1>' +
      '<p>' + escapeHtml(courseName) + '의 저장된 학습 기록을 분석합니다. 분석 과정에서 기존 오답·응시 기록을 수정하지 않습니다.</p>' +
      '</div>';

    html += '<div class="analytics-summary">' +
      '<article class="analytics-stat"><span>모의고사 응시</span><strong>' + report.totalExamAttempts + '<small>회</small></strong><em>상세 답안 ' + report.detailedAttempts + '회</em></article>' +
      '<article class="analytics-stat"><span>모의고사 평균 점수율</span><strong>' + percentLabel(report.averagePercent) + '</strong><em>' +
      (report.bestPercent === null ? '응시 기록 없음' : '최고 ' + percentLabel(report.bestPercent)) + '</em></article>' +
      '<article class="analytics-stat"><span>최근 모의고사</span><strong>' +
      (report.latestScore ? escapeHtml(report.latestScore.score + '/' + report.latestScore.max) + '<small>점</small>' : '—') +
      '</strong><em>' + (report.latestScore ? percentLabel(report.latestScore.percent) + ' · ' + new Date(report.latestScore.at).toLocaleDateString('ko-KR') : '응시 기록 없음') + '</em></article>' +
      '<article class="analytics-stat"><span>개념 문제 정답률</span><strong>' + percentLabel(report.conceptAccuracy) + '</strong><em>' +
      report.conceptCorrect + '/' + report.conceptTotal + '문항 · 누적 기록</em></article>' +
      '</div>';

    html += '<section class="q-card analytics-section"><div class="section-head"><h2>모의고사 성적 추이</h2><span>최근 ' + report.scoreTrend.length + '회 · 점수율 기준</span></div>';
    if (report.scoreTrend.length) {
      html += '<div class="analytics-chart" role="img" aria-label="최근 모의고사 점수율 막대 그래프">';
      report.scoreTrend.forEach(function (point) {
        var height = Math.max(3, Math.min(100, point.percent));
        var label = new Date(point.at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
        html += '<div class="analytics-chart-column" title="' + escapeHtml(point.label) + ' · ' +
          escapeHtml(point.score + '/' + point.max + '점 (' + Math.round(point.percent) + '%)') + '">' +
          '<span class="analytics-chart-value">' + Math.round(point.percent) + '%</span>' +
          '<div class="analytics-chart-track"><i style="height:' + height + '%"></i></div>' +
          '<span class="analytics-chart-date">' + escapeHtml(label) + '</span></div>';
      });
      html += '</div><p class="analytics-note">서로 다른 평가의 만점 차이를 보정하기 위해 원점수가 아닌 점수율로 표시합니다.</p>';
    } else {
      html += '<div class="analytics-empty">아직 모의고사 응시 기록이 없습니다.</div>';
    }
    html += '</section>';

    html += '<section class="q-card analytics-section"><div class="section-head"><h2>단원별 개념 정답률</h2><span>개념 문제 누적 풀이 기준</span></div>';
    if (report.unitMetrics.length) {
      html += '<div class="analytics-unit-list">';
      report.unitMetrics.forEach(function (unit) {
        var value = unit.accuracy === null ? 0 : unit.accuracy;
        var status = unit.questionCount === 0 ? '기록 없음' :
          (unit.questionCount < 3 ? '표본 적음' : (unit.accuracy < 60 ? '집중 복습' : (unit.accuracy < 80 ? '보완 권장' : '안정')));
        html += '<div class="analytics-unit-row"><div class="analytics-unit-copy"><b>' + escapeHtml(unit.name) +
          '</b><span>' + unit.correctCount + '/' + unit.questionCount + ' 정답 · ' + status + '</span></div>' +
          '<div class="analytics-unit-track"><i style="width:' + value + '%"></i></div>' +
          '<strong>' + percentLabel(unit.accuracy) + '</strong></div>';
      });
      html += '</div>';
    } else {
      html += '<div class="analytics-empty">이 과목에는 단원별 분류 데이터가 없습니다.</div>';
    }
    html += '<p class="analytics-note">이 지표는 기존 개념 문제의 누적 통계입니다. 모의고사 문항의 단원별 정답률과는 별도입니다.</p></section>';

    html += '<section class="q-card analytics-section"><div class="section-head"><h2>개념 문제 오답 집중 항목</h2><span>현재 오답 노트 기준</span></div>';
    if (report.conceptWeakness.length) {
      html += '<div class="analytics-weak-list">';
      report.conceptWeakness.forEach(function (item) {
        html += '<div class="analytics-weak-row"><div><b>' + escapeHtml(item.topic) + '</b><span>' +
          escapeHtml(item.unitName) + '</span></div><strong>누적 ' + item.wrongCount + '회</strong></div>';
      });
      html += '</div><button type="button" class="btn btn-ghost analytics-action" data-open-wrong>오답 노트 열기</button>';
    } else {
      html += '<div class="analytics-empty">현재 개념 문제 오답 노트에 남아 있는 문항이 없습니다.</div>';
    }
    html += '<p class="analytics-note">정답 처리되거나 사용자가 삭제한 과거 개념 오답 횟수는 문항별로 보존되지 않으므로, 현재 오답 노트에 남은 항목만 표시합니다.</p></section>';

    html += '<section class="q-card analytics-section"><div class="section-head"><h2>모의고사 오답 문항</h2><span>상세 응시 기록 ' + report.detailedAttempts + '회 분석</span></div>';
    if (report.examQuestionWeakness.length) {
      html += '<div class="analytics-weak-list">';
      report.examQuestionWeakness.forEach(function (item) {
        var label = item.examLabel + ' · ' + item.questionNumber + '번';
        var miss = item.incorrectCount + '회 오답';
        html += '<div class="analytics-weak-row"><div><b>' + escapeHtml(label) + '</b><span>' +
          item.attempts + '회 응시 · 정답 ' + item.correctCount + '회 · 미응답 ' + item.unansweredCount + '회</span></div>' +
          '<strong>' + miss + '</strong></div>';
      });
      html += '</div>';
    } else if (!report.detailedAttempts) {
      html += '<div class="analytics-empty">문항별 분석이 가능한 상세 응시 기록이 없습니다. 새 모의고사를 제출하면 다음부터 문항별 분석에 반영됩니다.</div>';
    } else {
      html += '<div class="analytics-empty">저장된 상세 응시 기록에서 오답 문항이 확인되지 않았습니다.</div>';
    }
    html += '<p class="analytics-note">미응답과 수동 채점 대기 문항은 오답 횟수에 포함하지 않습니다. 부분 점수를 받은 문항은 완전 정답과 구분합니다.</p></section>';

    html += '<section class="analytics-coverage"><div><b>분석 데이터 범위</b><p>전체 응시 기록 ' + report.totalExamAttempts + '회 중 상세 답안 ' +
      report.detailedAttempts + '회, 점수만 보존된 과거 기록 ' + report.scoreOnlyAttempts + '회입니다. 점수만 있는 기록은 성적 추이에만 반영됩니다.</p></div>' +
      '<div><b>모의고사 단원 분류</b><p>' + report.unitQuestionCoverage + '/' + report.assessmentQuestionCount +
      '문항에 단원 태그가 등록되어 있습니다. 현재는 단원별 모의고사 정답률을 계산하지 않으며, 임의로 단원을 추정하지 않습니다.</p></div>' +
      (report.pendingManualAttempts ? '<div><b>수동 채점 대기</b><p>' + report.pendingManualAttempts + '회의 응시 기록에 채점 대기 문항이 남아 있습니다.</p></div>' : '') +
      '</section>';

    html += '<div class="analytics-footer-actions"><button type="button" class="btn btn-primary" data-open-exam>모의고사 기록 보기</button>' +
      '<button type="button" class="btn btn-ghost" data-open-home>학습 홈으로</button></div>';
    view.innerHTML = html;

    var wrongButton = view.querySelector('[data-open-wrong]');
    if (wrongButton) wrongButton.addEventListener('click', function () {
      if (global.AppUI) global.AppUI.show('wrong');
    });
    var examButton = view.querySelector('[data-open-exam]');
    if (examButton) examButton.addEventListener('click', function () {
      if (global.AppUI) global.AppUI.show('exam');
    });
    var homeButton = view.querySelector('[data-open-home]');
    if (homeButton) homeButton.addEventListener('click', function () {
      if (global.AppUI) global.AppUI.show('home');
    });
  }

  global.StudyAnalytics = { calculate: calculate };
  global.AnalyticsUI = { analyze: analyze, render: render };
})(window);
