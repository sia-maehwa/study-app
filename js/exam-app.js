/* 사회문화 연습장 — 실전 모의고사 모드
   기출 15회분 + 수능 예상 모의고사 3회분(자체 제작)
   점수 채점(배점 합산) · 등급컷 · 도표 문항 제외 · 펜 필기 지원 */
(function () {
  'use strict';

  var CHOICE_LABELS = ['①', '②', '③', '④', '⑤'];
  var HIST_KEY = 'socmul_exam_hist_v1';
  var EXAM_WRONG_KEY = 'study_exam_wrong_v1';
  var NODOYO_KEY = 'socmul_nodopyo_v1';
  var PEN_KEY = 'socmul_pen_v1';
  var PEN_COLOR_KEY = 'socmul_pen_color_v1';
  var DEFAULT_PEN_COLOR = '#d6336c';

  var state = {
    courseId: 'social-culture',
    examId: null,
    answers: [],      /* 문항별 선택 (0~4, null=미응답) */
    idx: 0,
    deadline: 0,
    timerId: null,
    submitted: false,
    history: [],      /* { id, score, max, correct, total, at } */
    penMode: 'pen',   /* pen | eraser | off */
    penColor: (window.Store && window.Store.get(PEN_COLOR_KEY)) || DEFAULT_PEN_COLOR,
    strokes: {},      /* { 문항인덱스: [stroke, ...] } */
  };

  /* ─── 데이터 접근 ─── */
  function courseAssessmentData(courseId) {
    return window.StudyCourseRegistry
      ? window.StudyCourseRegistry.getAssessmentData(courseId || state.courseId)
      : null;
  }
  var assessmentCache = {};
  function allExams(courseId) {
    var id = courseId || state.courseId || 'social-culture';
    if (assessmentCache[id]) return assessmentCache[id].slice();
    var data = courseAssessmentData(id);
    if (!data) return [];
    var list = (data.officialExams || []).slice();
    (data.practiceExams || []).forEach(function (practice) { list.push(practice); });
    if (!window.AssessmentEngine) return list;
    assessmentCache[id] = list.map(function (assessment) {
      var predict = isPredict(assessment);
      var source = {};
      Object.keys(assessment).forEach(function (key) { source[key] = assessment[key]; });
      if (!predict && id === 'social-culture' && !source.questionImagePattern) {
        source.questionImagePattern = 'assets/exams/{assessmentId}/q{number}.jpg';
      }
      return window.AssessmentEngine.normalizeAssessment(source, {
        courseId: id,
        assessmentType: source.assessmentType || (predict ? 'self-produced-practice' : 'official-exam')
      });
    });
    return assessmentCache[id].slice();
  }
  function examById(id) {
    return allExams(state.courseId).filter(function (e) { return e.id === id; })[0] || null;
  }
  function isPredict(e) {
    if (!e) return false;
    var match = window.StudyCourseRegistry && window.StudyCourseRegistry.findAssessmentProfileForExam(e);
    if (match && match.profile && match.profile.category) return match.profile.category === 'practice';
    return e.assessmentCategory === 'practice' ||
      ['self-produced-practice', 'practice', 'quiz', 'homework'].indexOf(e.assessmentType || e.kind) !== -1 ||
      !!(e.id && e.id.indexOf('predict_') === 0);
  }
  function getAssessmentProfile(exam) {
    if (!window.StudyCourseRegistry || !exam) return null;
    var match = window.StudyCourseRegistry.findAssessmentProfileForExam(exam);
    return match ? match.profile : null;
  }
  function examDurationSec(exam) {
    var profile = getAssessmentProfile(exam);
    var duration = profile && Number(profile.durationSec);
    return Number.isFinite(duration) && duration > 0 ? duration : 30 * 60;
  }
  function imgSrc(examId, n) {
    return 'assets/exams/' + examId + '/q' + (n < 10 ? '0' + n : n) + '.jpg';
  }
  function unitName(u) {
    try {
      var content = window.StudyCourseRegistry && window.StudyCourseRegistry.getContent(state.courseId);
      var units = content && content.units ? content.units : [];
      var un = units.filter(function (x) { return x.id === u; })[0];
      return un ? un.name : '';
    } catch (err) { return ''; }
  }

  /* ─── 설정/기록 저장 ─── */
  function excludeDopyo() {
    return window.Store ? window.Store.get(NODOYO_KEY) === '1' : false;
  }
  function setExcludeDopyo(v) {
    if (window.Store) window.Store.set(NODOYO_KEY, v ? '1' : '');
  }
  function loadHistory() {
    state.history = window.Store ? window.Store.getJSON(HIST_KEY, []) : [];
    if (!Array.isArray(state.history)) state.history = [];
  }
  function saveHistory() {
    if (window.Store) window.Store.setJSON(HIST_KEY, state.history);
  }
  function bestRecord(id) {
    var best = null;
    state.history.forEach(function (h) {
      if (h.id === id && (best === null || h.score > best.score)) best = h;
    });
    return best;
  }
  function loadPen(examId) {
    var all = window.Store ? window.Store.getJSON(PEN_KEY, {}) : {};
    state.strokes = (all && all[examId]) ? all[examId] : {};
  }
  function savePen() {
    if (!window.Store || !state.examId) return;
    var all = window.Store.getJSON(PEN_KEY, {});
    all[state.examId] = state.strokes;
    window.Store.setJSON(PEN_KEY, all);
  }

  function loadExamWrongNotes() {
    var records = window.Store ? window.Store.getJSON(EXAM_WRONG_KEY, {}) : {};
    return records && typeof records === 'object' && !Array.isArray(records) ? records : {};
  }
  function saveExamWrongNotes(records) {
    if (window.Store) window.Store.setJSON(EXAM_WRONG_KEY, records);
  }
  function updateExamWrongNotes(exam) {
    var records = loadExamWrongNotes();
    var now = Date.now();
    includedIdx(exam).forEach(function (index) {
      var question = exam.questions[index];
      var selected = state.answers[index];
      var key = exam.id + ':' + question.n;
      var evaluation = window.AssessmentEngine
        ? window.AssessmentEngine.evaluateResponse(question, selected)
        : { status: selected === question.ans ? 'correct' : 'incorrect' };
      if (evaluation.status === 'correct' || evaluation.status === 'pending-manual') {
        delete records[key];
        return;
      }
      var previous = records[key];
      records[key] = {
        key: key,
        examId: exam.id,
        examLabel: exam.label,
        questionNumber: question.number || question.n,
        responseType: question.responseType || 'single-choice',
        response: selected === undefined ? null : selected,
        selectedIndex: selected === undefined ? null : selected,
        correctAnswer: question.answerKey,
        correctIndex: question.ans,
        points: question.points || question.pts || 2,
        attempts: previous ? (Number(previous.attempts) || 1) + 1 : 1,
        lastAttemptAt: now
      };
    });
    saveExamWrongNotes(records);
  }
  function getExamWrongNotes() {
    var records = loadExamWrongNotes();
    return Object.keys(records).map(function (key) { return records[key]; })
      .filter(function (record) { return record && record.examId && record.questionNumber; })
      .sort(function (a, b) { return (Number(b.lastAttemptAt) || 0) - (Number(a.lastAttemptAt) || 0); });
  }
  function removeExamWrongNote(key) {
    var records = loadExamWrongNotes();
    if (!Object.prototype.hasOwnProperty.call(records, key)) return;
    delete records[key];
    saveExamWrongNotes(records);
  }
  function clearExamWrongNotes() {
    saveExamWrongNotes({});
  }
  function retryExam(examId) {
    if (examById(examId)) startExam(examId);
  }

  /* ─── 도표 제외 로직 ─── */
  function includedIdx(e) {
    var r = [];
    if (!excludeDopyo()) {
      e.questions.forEach(function (_, i) { r.push(i); });
    } else {
      e.questions.forEach(function (q, i) { if (!q.d) r.push(i); });
    }
    return r;
  }
  function maxScore(e) {
    return includedIdx(e).reduce(function (s, i) {
      var question = e.questions[i];
      return s + (question.points || question.pts || 0);
    }, 0);
  }

  /* ─── 채점 ─── */
  function scoreExam(e) {
    var inc = includedIdx(e);
    var score = 0, correct = 0, blank = 0, pendingManual = 0;
    inc.forEach(function (i) {
      var q = e.questions[i];
      var mine = state.answers[i];
      if (!hasResponse(mine)) { blank++; return; }
      var evaluation = window.AssessmentEngine
        ? window.AssessmentEngine.evaluateResponse(q, mine)
        : { status: mine === q.ans ? 'correct' : 'incorrect', earnedPoints: mine === q.ans ? (q.pts || 2) : 0 };
      if (evaluation.status === 'pending-manual') { pendingManual++; return; }
      if (evaluation.status === 'correct') { score += evaluation.earnedPoints; correct++; }
    });
    return { score: score, max: maxScore(e), correct: correct, total: inc.length, blank: blank, pendingManual: pendingManual };
  }

  /* ─── 등급컷 ─── */
  function cutsFor(e) {
    var data = courseAssessmentData(state.courseId);
    if (isPredict(e)) return { cuts: data ? data.averageCuts : {}, note: '최근 5개년 평가원 기출 평균 등급컷 · 참고용' };
    /* 수능·모의평가 모두 원점수 등급컷은 주요 입시기관 추정치 종합(kicegg 제공). 평가원 공식 발표는 표준점수 기준임 */
    return { cuts: e.cuts, note: '주요 입시기관 원점수 추정 종합(kicegg 제공) · 참고용' };
  }
  function gradeOf(score, cuts) {
    for (var g = 1; g <= 8; g++) {
      if (score >= cuts[String(g)]) return g;
    }
    return 9;
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  }
  function stopTimer() {
    if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
  }

  /* ─── 시험 목록 ─── */
  function renderPicker(view, courseId) {
    stopTimer();
    state.courseId = courseId || state.courseId || 'social-culture';
    loadHistory();
    var courseExams = allExams(state.courseId);
    var predictExams = courseExams.filter(isPredict);
    var officialExams = courseExams.filter(function (exam) { return !isPredict(exam); });
    var assessmentData = courseAssessmentData(state.courseId);
    var hasDiagramItems = courseExams.some(function (exam) {
      return exam.questions.some(function (question) { return !!question.d; });
    });
    var totalOfficialQuestions = officialExams.reduce(function (total, exam) { return total + exam.questions.length; }, 0);
    var totalPracticeQuestions = predictExams.reduce(function (total, exam) { return total + exam.questions.length; }, 0);

    var html = '<div class="hero exam-hero">' +
      '<span class="hero-kicker">과목별 평가 · 기출 및 연습 시험</span>' +
      '<h1>응시할 평가를<br>선택해 주세요</h1>' +
      '<p>등록된 평가 ' + courseExams.length + '회 · 총 ' + (totalOfficialQuestions + totalPracticeQuestions) +
      '문항입니다. 각 평가의 문항 유형과 제한 시간에 맞춰 진행하며, 자동 채점과 수동 채점 상태를 구분합니다.</p>' +
      '</div>';

    /* 도표 제외 설정은 도표 문항이 있는 과목에만 표시합니다. */
    if (hasDiagramItems) {
      html += '<div class="dopyo-toggle' + (excludeDopyo() ? ' on' : '') + '">' +
        '<div class="dt-text"><b>도표(표·그래프) 문항 제외</b>' +
        '<span>표나 그래프 자료가 포함된 문항을 빼고 응시합니다. 채점 만점은 제외 문항 배점을 뺀 점수가 됩니다.</span></div>' +
        '<button type="button" class="dt-switch" data-dopyo-toggle role="switch" aria-checked="' + excludeDopyo() + '" aria-label="도표 문항 제외"><span class="dt-knob"></span></button></div>';
    }

    /* 예상 모의고사 */
    if (predictExams.length) {
      html += '<div class="section-head predict-head"><h2>연습·과제</h2><span>' + predictExams.length + '회</span></div>';
      html += '<div class="exam-year-row"><div class="exam-cards predict-cards">';
      predictExams.forEach(function (e) {
        var best = bestRecord(e.id);
        var durationMinutes = Math.round(examDurationSec(e) / 60);
        html += '<button type="button" class="exam-card predict-card" data-start-exam="' + e.id + '">' +
          '<span class="exam-card-kind">' + esc2(assessmentProfileLabel(e) || e.assessmentType || '연습 평가') + '</span>' +
          '<span class="exam-card-title">' + esc2(e.label) + '</span>' +
          '<span class="exam-card-meta">' + e.questions.length + '문항 · ' + maxScore(e) + '점' +
          (durationMinutes ? ' · ' + durationMinutes + '분' : '') +
          (best ? ' · 최고 <b>' + best.score + '점</b>' : '') + '</span>' +
          (e.sub ? '<span class="predict-sub">' + esc2(e.sub) + '</span>' : '') + '</button>';
      });
      html += '</div></div>';

      /* 사회·문화 자체 제작 예상 문항의 출제 비중 분석 노트 */
      if (state.courseId === 'social-culture' && assessmentData && assessmentData.unitFrequency) {
        html += '<details class="predict-note"><summary>이 예상 문제지는 어떻게 만들었나요? (기출 분석 노트)</summary><div class="pn-body">' +
          '<p>최근 5개년(2022~2026) 평가원 기출 15회, 300문항의 <b>단원별 출제 비중</b>을 분석해 그 분포를 따랐고, 최근 수능에서 반복되는 유형(빈출 개념 조합, 3점 변별력 문항 형식)을 참고해 자체 제작했습니다. 실제 출제 문항과 무관하며 학습용 예상 문제입니다.</p>' +
          '<div class="unit-freq">';
        var unitFrequency = assessmentData.unitFrequency;
        var content = window.StudyCourseRegistry && window.StudyCourseRegistry.getContent(state.courseId);
        var courseUnits = content && content.units ? content.units : [];
        courseUnits.forEach(function (unit) {
          var n = unitFrequency[unit.id] || 0;
          html += '<div class="uf-row"><span class="uf-name">' + esc2(unitName(unit.id)) + '</span>' +
            '<span class="uf-bar"><span class="uf-fill" style="width:' + Math.round(n / 83 * 100) + '%"></span></span>' +
            '<span class="uf-val">' + n + '문항</span></div>';
        });
        html += '</div></div></details>';
      }
    }

    function assessmentProfileLabel(exam) {
      var match = window.StudyCourseRegistry && window.StudyCourseRegistry.findAssessmentProfileForExam(exam);
      return match && match.profile ? match.profile.label : '';
    }

    /* 등록된 기출·정규 평가 */
    html += '<div class="section-head" style="margin-top:var(--space-8)"><h2>기출·정규 평가</h2>' +
      '<span>' + officialExams.length + '회 · ' + totalOfficialQuestions + '문항</span></div>';
    var years = [];
    officialExams.forEach(function (exam) {
      if (exam.year && years.indexOf(exam.year) === -1) years.push(exam.year);
    });
    years.sort(function (a, b) { return b - a; });

    function sessionLabel(exam) {
      if (exam.kind === 'suneung') return '수능';
      if (exam.kind === 'june') return '6월 모의평가';
      if (exam.kind === 'sept') return '9월 모의평가';
      return assessmentProfileLabel(exam) || exam.assessmentType || exam.kind || '정규 평가';
    }
    function examCardHtml(exam) {
      var best = bestRecord(exam.id);
      var durationMinutes = Math.round(examDurationSec(exam) / 60);
      return '<button type="button" class="exam-card" data-start-exam="' + esc2(exam.id) + '">' +
        '<span class="exam-card-kind">' + esc2(sessionLabel(exam)) + '</span>' +
        '<span class="exam-card-title">' + esc2(exam.label || exam.title || exam.id) + '</span>' +
        '<span class="exam-card-meta">' + exam.questions.length + '문항 · ' + maxScore(exam) + '점' +
        (durationMinutes ? ' · ' + durationMinutes + '분' : '') +
        (best !== null ? ' · 최고 <b>' + best.score + '점</b>' : '') + '</span></button>';
    }

    if (years.length) {
      years.forEach(function (year) {
        html += '<div class="exam-year-row"><h3 class="exam-year">' + year + '학년도</h3><div class="exam-cards">';
        officialExams.filter(function (exam) { return exam.year === year; })
          .forEach(function (exam) { html += examCardHtml(exam); });
        html += '</div></div>';
      });
      var noYear = officialExams.filter(function (exam) { return !exam.year; });
      if (noYear.length) {
        html += '<div class="exam-year-row"><div class="exam-cards">';
        noYear.forEach(function (exam) { html += examCardHtml(exam); });
        html += '</div></div>';
      }
    } else if (officialExams.length) {
      html += '<div class="exam-year-row"><div class="exam-cards">';
      officialExams.forEach(function (exam) { html += examCardHtml(exam); });
      html += '</div></div>';
    } else {
      html += '<div class="empty-state"><strong>등록된 기출·정규 평가가 없습니다</strong>연습 평가를 이용하거나 콘텐츠가 준비된 뒤 다시 확인해 주세요.</div>';
    }

    html += '<p class="exam-src-note">' + esc2((window.StudyCourseRegistry && window.StudyCourseRegistry.get(state.courseId) || {}).title || '과목') +
      ' 평가 데이터는 과목별 콘텐츠 모듈에서 불러옵니다.</p>';
    if (window.Store && !window.Store.persistent) {
      html += '<p class="exam-src-note">이 브라우저에서는 기록 저장이 제한되어 페이지를 닫으면 응시 기록이 사라질 수 있습니다.</p>';
    }

    view.innerHTML = html;
    view.querySelectorAll('[data-start-exam]').forEach(function (b) {
      b.addEventListener('click', function () { startExam(b.dataset.startExam); });
    });
    var dt = view.querySelector('[data-dopyo-toggle]');
    if (dt) dt.addEventListener('click', function () {
      setExcludeDopyo(!excludeDopyo());
      renderPicker(view);
    });
  }

  /* ─── 응시 ─── */
  function startExam(examId) {
    var app = window.AppUI;
    var e = examById(examId);
    if (!e) return;
    state.examId = examId;
    state.answers = new Array(e.questions.length).fill(null);
    state.idx = 0;
    state.submitted = false;
    state.penMode = 'pen';
    loadPen(examId);
    /* 첫 (포함된) 문항으로 이동 */
    var inc = includedIdx(e);
    if (inc.length && inc.indexOf(0) === -1) state.idx = inc[0];
    state.deadline = Date.now() + examDurationSec(e) * 1000;
    if (app) app.show('examrun');
    startTimer();
  }

  function startTimer() {
    stopTimer();
    state.timerId = setInterval(tickTimer, 500);
    tickTimer();
  }

  function tickTimer() {
    var el = document.getElementById('examTimer');
    if (!el) return;
    var left = (state.deadline - Date.now()) / 1000;
    if (left <= 0 && !state.submitted) {
      stopTimer();
      el.textContent = '00:00';
      el.classList.add('danger');
      submitExam(true);
      return;
    }
    el.textContent = fmtTime(left);
    el.classList.toggle('warn', left < 300);
  }

  /* ─── 펜 필기 ─── */
  function penBarHtml() {
    var colors = [['#d6336c', '빨강'], ['#2563eb', '파랑'], ['#20252b', '검정'], ['#16a34a', '초록'], ['#9333ea', '보라'], ['#ea580c', '주황']];
    return '<div class="pen-bar" aria-label="필기 도구">' +
      '<span class="pen-bar-label">필기 도구</span>' +
      '<button type="button" class="pen-tool' + (state.penMode === 'pen' ? ' active' : '') + '" data-penmode="pen" aria-pressed="' + (state.penMode === 'pen') + '">펜</button>' +
      '<button type="button" class="pen-tool' + (state.penMode === 'eraser' ? ' active' : '') + '" data-penmode="eraser" aria-pressed="' + (state.penMode === 'eraser') + '">지우개</button>' +
      '<button type="button" class="pen-tool' + (state.penMode === 'off' ? ' active' : '') + '" data-penmode="off" aria-pressed="' + (state.penMode === 'off') + '">필기 끄기</button>' +
      '<span class="pen-palette" role="group" aria-label="펜 색상">' + colors.map(function (item) {
        return '<button type="button" class="pen-color' + (state.penColor === item[0] ? ' active' : '') + '" data-pencolor="' + item[0] + '" aria-label="' + item[1] + '" title="' + item[1] + '" aria-pressed="' + (state.penColor === item[0]) + '"><i style="background:' + item[0] + '"></i></button>';
      }).join('') + '</span>' +
      '<button type="button" class="pen-tool" data-penundo disabled>실행 취소</button>' +
      '<button type="button" class="pen-tool" data-penredo disabled>다시 실행</button>' +
      '<button type="button" class="pen-tool" data-penclear>전체 지우기</button>' +
      '<span class="pen-input-hint">펜: 필기 · 손가락: 화면 드래그</span>' +
      '</div>';
  }

  function bindPen(view, qIdx) {
    if (!window.PenTools) return null;
    var tools = window.PenTools.bind({
      root: view,
      mode: state.penMode,
      color: state.penColor,
      getStrokes: function () { return state.strokes[qIdx] || (state.strokes[qIdx] = []); },
      save: savePen,
      onModeChange: function (mode) { state.penMode = mode; },
      onColorChange: function (color) { state.penColor = color; if (window.Store) window.Store.set(PEN_COLOR_KEY, color); },
      clearMessage: '이 문항의 필기를 모두 지울까요?'
    });
    if (tools) view._penToolsCleanup = tools.destroy;
    return tools;
  }

  function questionPromptHtml(question) {
    var prompt = question.prompt !== undefined ? question.prompt : question.q;
    if (typeof prompt === 'string' && prompt.length) {
      return '<div class="pq-q">' + (question.promptFormat === 'text' ? esc2(prompt) : prompt) + '</div>';
    }
    if (prompt && typeof prompt === 'object') {
      var promptContent = prompt.content == null ? '' : String(prompt.content);
      var promptFormat = prompt.format || question.promptFormat || 'text';
      return '<div class="pq-q">' + (promptFormat === 'html' ? promptContent : esc2(promptContent)) + '</div>';
    }
    return '';
  }

  function questionStimulusHtml(question, exam, index) {
    var promptHtml = questionPromptHtml(question);
    var stimulus = question.stimulus;
    if (!stimulus) {
      if (promptHtml) return promptHtml;
      return '<img class="exam-qimg" id="examQImg" src="' + imgSrc(exam.id, index + 1) +
        '" alt="' + esc2(exam.label) + ' ' + (index + 1) + '번 문항" loading="eager" />';
    }
    var type = stimulus.type || 'html';
    var contentValue = stimulus.content == null ? '' : stimulus.content;
    var content = typeof contentValue === 'string' ? contentValue : '';
    var assets = Array.isArray(stimulus.assets) ? stimulus.assets : [];
    var src = stimulus.src || stimulus.url || assets[0] || '';
    var body = '';

    if (type === 'image') {
      body = assets.length
        ? assets.map(function (asset, assetIndex) {
            var url = typeof asset === 'string' ? asset : (asset.url || asset.src || '');
            var alt = typeof asset === 'object' && asset.alt ? asset.alt : (question.prompt || exam.label);
            return '<img class="exam-qimg" ' + (assetIndex === 0 ? 'id="examQImg" ' : '') +
              'src="' + esc2(url) + '" alt="' + esc2(alt) + '" loading="eager" />';
          }).join('')
        : '<img class="exam-qimg" id="examQImg" src="' + esc2(src) + '" alt="' +
          esc2(question.prompt || exam.label) + '" loading="eager" />';
    } else if (type === 'audio') {
      body = '<audio class="exam-response-audio" controls preload="metadata" src="' + esc2(src) + '">' +
        '오디오를 재생할 수 없습니다.</audio>';
    } else if (type === 'code') {
      body = '<pre class="exam-stimulus-code"><code>' + esc2(content || JSON.stringify(contentValue, null, 2)) + '</code></pre>';
    } else if (type === 'text') {
      body = '<div class="exam-stimulus-text">' + esc2(content || contentValue) + '</div>';
    } else if (type === 'table' && contentValue && typeof contentValue === 'object') {
      var headers = contentValue.headers || contentValue.columns || [];
      var rows = contentValue.rows || [];
      body = '<div class="exam-stimulus-table"><table><thead><tr>' +
        headers.map(function (header) { return '<th>' + esc2(header) + '</th>'; }).join('') +
        '</tr></thead><tbody>' + rows.map(function (row) {
          return '<tr>' + (Array.isArray(row) ? row : []).map(function (cell) {
            return '<td>' + esc2(cell) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>';
    } else if (type === 'chart' && contentValue && typeof contentValue === 'object') {
      var chartText = contentValue.description || JSON.stringify(contentValue, null, 2);
      body = '<pre class="exam-stimulus-code">' + esc2(chartText) + '</pre>';
    } else if (type === 'math') {
      var mathContent = content || (contentValue && contentValue.latex) || '';
      body = '<div class="exam-stimulus-math">' + mathContent + '</div>';
    } else {
      body = '<div class="exam-stimulus-' + esc2(type) + '">' + content + '</div>';
    }

    return promptHtml + body;
  }

  function renderResponseControl(question, index) {
    var responseType = question.responseType || 'single-choice';
    var value = state.answers[index];
    var options = question.options || [];
    var useTextLayout = !!(question.q || (question.prompt && (typeof question.prompt === 'object' || String(question.prompt).length)));
    if (responseType === 'single-choice' || responseType === 'multiple-select') {
      if (!options.length && Array.isArray(question.c)) {
        options = question.c.map(function (choice, choiceIndex) {
          return { id: 'option-' + choiceIndex, content: choice };
        });
      }
      var multiple = responseType === 'multiple-select';
      var selected = Array.isArray(value) ? value : (value === null || value === undefined ? [] : [value]);
      return '<div class="' + (useTextLayout ? 'pq-choices' : 'omr') + '" role="group" aria-label="' +
        (multiple ? '복수 답안 선택' : '답안 선택') + '">' +
        options.map(function (option, optionIndex) {
          var marked = multiple ? selected.indexOf(optionIndex) !== -1 : value === optionIndex;
          var label = CHOICE_LABELS[optionIndex] || String(optionIndex + 1);
          var content = option.content !== undefined ? option.content : option.text || '';
          if (useTextLayout) {
            return '<button type="button" class="pq-choice' + (marked ? ' marked' : '') + '" ' +
              (multiple ? 'data-multi-choice="' + optionIndex + '"' : 'data-omr="' + optionIndex + '"') +
              ' aria-pressed="' + marked + '"><span class="pq-clab">' + label + '</span>' +
              '<span class="pq-ctext">' + content + '</span></button>';
          }
          return '<button type="button" class="omr-btn' + (marked ? ' marked' : '') + '" ' +
            (multiple ? 'data-multi-choice="' + optionIndex + '"' : 'data-omr="' + optionIndex + '"') +
            ' aria-pressed="' + marked + '"><span class="omr-num">' + label + '</span>' +
            '<span class="omr-state">' + (marked ? '선택됨' : '') + '</span></button>';
        }).join('') + '</div>' +
        (multiple ? '<p class="exam-response-hint">정답으로 판단되는 항목을 모두 선택해 주세요.</p>' : '');
    }
    if (responseType === 'short-answer' || responseType === 'numeric') {
      var inputType = responseType === 'numeric' ? 'number' : 'text';
      return '<label class="exam-response-field"><span>' +
        (responseType === 'numeric' ? '수치 답안' : '단답형 답안') + '</span>' +
        '<input class="exam-response-input" type="' + inputType + '"' +
        (responseType === 'numeric' ? ' step="any" inputmode="decimal"' : ' autocomplete="off"') +
        ' data-response-input value="' + esc2(value == null ? '' : value) +
        '" aria-label="' + (responseType === 'numeric' ? '수치 답안 입력' : '단답형 답안 입력') + '" /></label>';
    }
    if (responseType === 'essay' || responseType === 'code') {
      return '<label class="exam-response-field"><span>' +
        (responseType === 'code' ? '코드 답안' : '서술형 답안') + '</span>' +
        '<textarea class="exam-response-textarea' + (responseType === 'code' ? ' code' : '') +
        '" data-response-input rows="' + (responseType === 'code' ? '12' : '7') + '"' +
        (responseType === 'code' ? ' spellcheck="false"' : '') +
        ' aria-label="' + (responseType === 'code' ? '코드 답안 입력' : '서술형 답안 입력') + '">' +
        esc2(value == null ? '' : value) + '</textarea></label>' +
        '<p class="exam-response-hint">제출 후 채점 기준에 따라 별도 채점이 필요합니다.</p>';
    }
    return '<p class="exam-response-hint">지원하지 않는 응답 유형입니다: ' + esc2(responseType) + '</p>';
  }

  function renderRun(view) {
    var e = examById(state.examId);
    if (!e) { if (window.AppUI) window.AppUI.show('exam'); return; }
    var inc = includedIdx(e);
    var pos = inc.indexOf(state.idx);
    if (pos === -1) pos = 0;
    var n = state.idx + 1;
    var predict = isPredict(e);
    var q = e.questions[state.idx];

    var html = '<div class="exam-run-top">' +
      '<div class="exam-run-info"><span class="quiz-tag exam-tag">' + esc2(e.label) + '</span>' +
      '<span class="exam-run-q">' + (pos + 1) + ' / ' + inc.length + '</span></div>' +
      '<div class="exam-run-right"><span class="exam-timer" id="examTimer">' + fmtTime(examDurationSec(e)) + '</span>' +
      '<button class="quiz-exit" data-exit-exam type="button">✕ 나가기</button></div></div>';

    html += '<div class="exam-progress"><div class="progress-track"><div class="progress-fill" style="width:' + ((pos + 1) / inc.length * 100) + '%"></div></div></div>';

    html += penBarHtml();

    var responseType = q.responseType || 'single-choice';
    var questionClass = predict || q.q ? 'exam-qcard predict-card2' : 'exam-qcard';
    html += '<div class="' + questionClass + '">' +
      '<div class="' + (predict || q.q ? 'pq-head' : 'exam-question-head') + '">' +
      '<span class="' + (predict || q.q ? 'pq-num' : 'exam-question-number') + '">' + (q.number || q.n || n) + '번</span>' +
      '<span class="' + (predict || q.q ? 'pq-badje' : 'exam-question-points') + '">' + (q.points || q.pts || 0) + '점</span>' +
      (q.d ? '<span class="pq-badje dopyo">도표</span>' : '') +
      '<span class="exam-question-type">' + esc2(responseType) + '</span></div>' +
      '<div class="exam-qwrap">' + questionStimulusHtml(q, e, state.idx) + '</div>' +
      renderResponseControl(q, state.idx) +
      '</div>';

    var lastQ = inc[inc.length - 1] === state.idx;
    html += '<div class="exam-run-nav">' +
      '<button class="btn btn-ghost" data-exam-prev type="button"' + (pos === 0 ? ' disabled' : '') + '>← 이전</button>' +
      '<div class="omr-grid" aria-label="문항 이동">' +
      e.questions.map(function (qq, i) {
        var excluded = inc.indexOf(i) === -1;
        var cur = i === state.idx;
        var done = !excluded && hasResponse(state.answers[i]);
        return '<button type="button" class="omr-cell' + (cur ? ' cur' : '') + (done ? ' done' : '') + (excluded ? ' excl' : '') + '"' +
          (excluded ? ' disabled title="도표 문항 제외됨"' : ' data-goto="' + i + '"') + '>' + (i + 1) + '</button>';
      }).join('') + '</div>' +
      (lastQ
        ? '<button class="btn btn-primary" data-exam-submit type="button">시험 종료</button>'
        : '<button class="btn btn-primary" data-exam-next type="button">다음 →</button>') +
      '</div>';

    if (lastQ) {
      var unanswered = inc.filter(function (i) { return !hasResponse(state.answers[i]); }).length;
      if (unanswered === 0) {
        html += '<p class="exam-submit-hint">모든 문항에 답안을 표기했습니다. 준비되면 시험을 종료하세요.</p>';
      } else {
        html += '<p class="exam-submit-hint warn2">미표기 문항이 ' + unanswered + '개 있습니다. 시험을 종료하면 그대로 채점됩니다.</p>';
      }
    }

    view.innerHTML = html;
    tickTimer();

    /* 답안 선택 */
    view.querySelectorAll('[data-omr]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.answers[state.idx] = parseInt(b.dataset.omr, 10);
        renderRun(view);
      });
    });
    view.querySelectorAll('[data-multi-choice]').forEach(function (b) {
      b.addEventListener('click', function () {
        var selected = Array.isArray(state.answers[state.idx]) ? state.answers[state.idx].slice() : [];
        var optionIndex = parseInt(b.dataset.multiChoice, 10);
        var existing = selected.indexOf(optionIndex);
        if (existing === -1) selected.push(optionIndex);
        else selected.splice(existing, 1);
        state.answers[state.idx] = selected;
        renderRun(view);
      });
    });
    var responseInput = view.querySelector('[data-response-input]');
    if (responseInput) responseInput.addEventListener('input', function () {
      state.answers[state.idx] = responseInput.value;
      var cell = view.querySelector('[data-goto="' + state.idx + '"]');
      if (cell) cell.classList.toggle('done', hasResponse(responseInput.value));
    });
    /* 문항 이동 (도표 제외 문항은 건너뜀) */
    var prev = view.querySelector('[data-exam-prev]');
    if (prev && !prev.disabled) prev.addEventListener('click', function () {
      var p = inc.indexOf(state.idx); if (p > 0) { state.idx = inc[p - 1]; renderRun(view); }
    });
    var next = view.querySelector('[data-exam-next]');
    if (next) next.addEventListener('click', function () {
      var p = inc.indexOf(state.idx); if (p < inc.length - 1) { state.idx = inc[p + 1]; renderRun(view); }
    });
    view.querySelectorAll('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { state.idx = parseInt(b.dataset.goto, 10); renderRun(view); });
    });
    var submit = view.querySelector('[data-exam-submit]');
    if (submit) submit.addEventListener('click', function () { submitExam(false); });
    var exit = view.querySelector('[data-exit-exam]');
    if (exit) exit.addEventListener('click', function () {
      stopTimer();
      if (window.AppUI) window.AppUI.show('exam');
    });

    /* 현재 문항 화면 전체를 필기 면으로 사용합니다. */
    bindPen(view, state.idx);
  }

  function hasResponse(value) {
    if (value === null || value === undefined || value === '') return false;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }

  function submitExam(auto) {
    if (state.submitted) return;
    var e = examById(state.examId);
    var inc = includedIdx(e);
    var unanswered = inc.filter(function (i) { return !hasResponse(state.answers[i]); }).length;
    if (!auto && unanswered > 0) {
      if (!window.confirm(unanswered + '문항이 미표기 상태입니다. 그대로 제출할까요?')) return;
    }
    if (auto) window.alert('제한 시간이 종료되어 자동 제출되었습니다.');
    state.submitted = true;
    stopTimer();
    updateExamWrongNotes(e);
    var r = scoreExam(e);
    /* 학습 게임(지식의 탑) 성장 연동 */
    if (window.GameUI) window.GameUI.reportExam({ score: r.score, max: r.max, correct: r.correct, label: e.label });
    loadHistory();
    state.history.push({ id: state.examId, score: r.score, max: r.max, correct: r.correct, total: r.total, at: Date.now() });
    saveHistory();
    if (window.AppUI) window.AppUI.show('examresult');
  }

  function choiceIndex(value, question) {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value === 'string') {
      var numeric = /^\\d+$/.test(value) ? Number(value) : NaN;
      if (Number.isInteger(numeric)) return numeric;
      var options = question.options || [];
      for (var i = 0; i < options.length; i += 1) {
        if (options[i].id === value) return i;
      }
    }
    return -1;
  }

  function formattedResponse(question, response) {
    if (!hasResponse(response)) return '미응답';
    var type = question.responseType || 'single-choice';
    if (type === 'single-choice') {
      var index = choiceIndex(response, question);
      return index >= 0 ? (CHOICE_LABELS[index] || String(index + 1)) : String(response);
    }
    if (type === 'multiple-select') {
      var values = Array.isArray(response) ? response : [response];
      return values.map(function (value) {
        var index = choiceIndex(value, question);
        return index >= 0 ? (CHOICE_LABELS[index] || String(index + 1)) : String(value);
      }).join(', ');
    }
    return String(response);
  }

  function formattedAnswer(question) {
    var type = question.responseType || 'single-choice';
    var answer = question.answerKey;
    if (type === 'single-choice') {
      var index = choiceIndex(answer, question);
      return index >= 0 ? (CHOICE_LABELS[index] || String(index + 1)) : '정답 미설정';
    }
    if (type === 'multiple-select') {
      return (Array.isArray(answer) ? answer : []).map(function (value) {
        var index = choiceIndex(value, question);
        return index >= 0 ? (CHOICE_LABELS[index] || String(index + 1)) : String(value);
      }).join(', ');
    }
    if (type === 'short-answer') return (Array.isArray(answer) ? answer : [answer]).filter(function (v) { return v != null; }).join(' / ');
    if (type === 'numeric') {
      if (answer && typeof answer === 'object') return String(answer.value) + (answer.tolerance ? ' (허용 오차 ±' + answer.tolerance + ')' : '');
      return String(answer);
    }
    if (type === 'essay' || type === 'code') return '수동 채점 기준';
    return '—';
  }

  function reviewChoiceHtml(question, response) {
    var type = question.responseType || 'single-choice';
    if (type !== 'single-choice' && type !== 'multiple-select') return '';
    var options = question.options || [];
    var selected = Array.isArray(response) ? response : (response == null ? [] : [response]);
    var correct = Array.isArray(question.answerKey) ? question.answerKey : [question.answerKey];
    return '<div class="pq-choices review">' + options.map(function (option, index) {
      var wasSelected = selected.some(function (value) { return choiceIndex(value, question) === index; });
      var isCorrect = correct.some(function (value) { return choiceIndex(value, question) === index; });
      var content = option.content || '';
      return '<div class="pq-choice' + (isCorrect ? ' correct' : '') +
        (wasSelected && !isCorrect ? ' wrong' : '') + '">' +
        '<span class="pq-clab">' + (CHOICE_LABELS[index] || String(index + 1)) + '</span>' +
        '<span class="pq-ctext">' + content + '</span></div>';
    }).join('') + '</div>';
  }

  /* ─── 결과 ─── */
  function renderResult(view) {
    var e = examById(state.examId);
    if (!e) { if (window.AppUI) window.AppUI.show('exam'); return; }
    var r = scoreExam(e);
    var pct = r.max > 0 ? Math.round(r.score / r.max * 100) : 0;
    var inc = includedIdx(e);
    var nodopyo = excludeDopyo() && e.questions.some(function (q) { return q.d; });
    var cf = cutsFor(e);

    /* 등급 산출 */
    var gradeScore = r.score;
    var scaledNote = '';
    if (nodopyo && r.max > 0 && r.max !== 50) {
      gradeScore = Math.round(r.score * 50 / r.max * 10) / 10;
      scaledNote = '도표 문항 제외로 환산 점수(' + gradeScore + '점/50점) 기준 추정이므로 참고용입니다.';
    }
    var myGrade = r.pendingManual ? '채점 대기' : gradeOf(gradeScore, cf.cuts);

    var html = '<div class="result-hero exam-result-hero">' +
      '<div class="result-score">' + r.score + '<small>/' + r.max + '점</small></div>' +
      '<div class="result-msg">' + examResultMsg(pct) + '</div>' +
      '<div class="result-sub">' + esc2(e.label) + ' · 정답 ' + r.correct + '문항 / ' + r.total + '문항' +
      (r.blank ? ' · 미응답 ' + r.blank + '문항' : '') +
      (r.pendingManual ? ' · 수동 채점 대기 ' + r.pendingManual + '문항' : '') + '</div>' +
      '<div class="grade-badge">' + (r.pendingManual ? '수동 채점 필요 <b>' + r.pendingManual + '문항</b>' : '예상 등급 <b>' + myGrade + '등급</b>') +
      (nodopyo ? ' <span class="grade-note">(참고)</span>' : '') + '</div>' +
      '<div class="result-actions">' +
      '<button class="btn btn-primary" data-exam-again type="button">같은 시험 다시 풀기</button>' +
      '<button class="btn btn-ghost" data-export-ai type="button">AI 분석 보고서 다운로드</button>' +
      '<button class="btn btn-ghost" data-exam-list type="button">시험지 목록으로</button>' +
      '</div></div>';

    /* 등급컷 표 — 수동 채점이 남아 있으면 점수 확정 전이므로 표시하지 않습니다. */
    if (!r.pendingManual) {
      html += '<div class="q-card cut-card"><h3 class="cut-title">원점수 등급컷</h3>' +
        (scaledNote ? '<p class="cut-warn">' + scaledNote + '</p>' : '') +
        '<table class="cut-table"><thead><tr><th>등급</th>';
      for (var g = 1; g <= 8; g++) html += '<th>' + g + '</th>';
      html += '<th>9등급</th></tr></thead><tbody><tr><th>원점수</th>';
      for (g = 1; g <= 8; g++) {
        html += '<td class="' + (myGrade === g ? 'mine' : '') + '">' + cf.cuts[String(g)] + '점 이상</td>';
      }
      html += '<td class="' + (myGrade === 9 ? 'mine' : '') + '">—</td></tr></tbody></table>' +
        '<p class="cut-src">' + cf.note + ' · 내 점수: ' + gradeScore + '점 → <b>' + myGrade + '등급</b></p>' +
        '<p class="cut-src dim">등급컷은 시험마다 난이도에 따라 달라지며, 위 수치는 해당 회차 실제(또는 추정) 값입니다.</p></div>';
    }

    /* 문항별 결과 */
    html += '<div class="q-card"><h3 style="font-size:var(--text-lg);font-weight:800;margin-bottom:var(--space-4)">문항별 결과</h3>' +
      '<table class="result-table"><thead><tr><th>번호</th><th>배점</th><th>내 답안</th><th>정답</th><th>결과</th></tr></thead><tbody>';
    e.questions.forEach(function (q, i) {
      var excluded = inc.indexOf(i) === -1;
      var mine = state.answers[i];
      var evaluation = !excluded && window.AssessmentEngine
        ? window.AssessmentEngine.evaluateResponse(q, mine)
        : { status: mine === q.ans ? 'correct' : (hasResponse(mine) ? 'incorrect' : 'unanswered') };
      var ok = !excluded && evaluation.status === 'correct';
      var verdict = evaluation.status === 'pending-manual' ? '채점 대기' : (ok ? '정답' : (evaluation.status === 'unanswered' ? '미응답' : '오답'));
      if (excluded) {
        html += '<tr class="excl-row"><td>' + (i + 1) + '번</td><td>' + (q.pts || 2) + '점</td>' +
          '<td colspan="2">도표 문항 제외</td><td class="dim2">—</td></tr>';
      } else {
        html += '<tr><td>' + (i + 1) + '번</td><td>' + (q.points || q.pts || 0) + '점</td>' +
          '<td>' + esc2(formattedResponse(q, mine)) + '</td>' +
          '<td>' + esc2(formattedAnswer(q)) + '</td>' +
          '<td class="' + (ok ? 'ok' : (evaluation.status === 'pending-manual' ? 'dim2' : 'no')) + '">' + verdict + '</td></tr>';
      }
    });
    html += '</tbody></table></div>';

    /* 문항별 검토 */
    html += '<div class="section-head" style="margin-top:var(--space-8)"><h2>문항별 검토</h2><span>문항을 눌러 문제와 내 답안을 확인하세요</span></div>';
    html += '<div class="exam-review-list">';
    e.questions.forEach(function (q, i) {
      var excluded = inc.indexOf(i) === -1;
      var mine = state.answers[i];
      var evaluation = !excluded && window.AssessmentEngine
        ? window.AssessmentEngine.evaluateResponse(q, mine)
        : { status: mine === q.ans ? 'correct' : (hasResponse(mine) ? 'incorrect' : 'unanswered') };
      var ok = !excluded && evaluation.status === 'correct';
      var verdict = excluded ? '제외' : (evaluation.status === 'pending-manual' ? '채점 대기' :
        (ok ? '정답' : (evaluation.status === 'unanswered' ? '미응답' : '오답')));
      html += '<details class="exam-review' + (!ok && !excluded ? ' wrong-q' : '') + (excluded ? ' excl-q' : '') + '">' +
        '<summary><span class="er-num">' + (i + 1) + '번</span>' +
        '<span class="er-verdict ' + (ok ? 'ok' : 'no') + (excluded ? ' dim2' : '') + '">' + verdict + '</span>' +
        '<span class="er-ans">' + (excluded ? '도표 문항 제외' : '내 답 ' + esc2(formattedResponse(q, mine)) +
          ' · 정답 ' + esc2(formattedAnswer(q)) + ' · ' + (q.points || q.pts || 0) + '점') + '</span></summary>';
      html += '<div class="er-body">' +
        questionStimulusHtml(q, e, i) +
        reviewChoiceHtml(q, mine) +
        (q.explanation ? '<div class="pq-expl"><b>해설</b> ' + q.explanation + '</div>' : '') +
        (evaluation.status === 'pending-manual' ? '<p class="exam-response-hint">이 문항은 제출 후 별도 채점이 필요합니다.</p>' : '') +
        '</div>';
      html += '</details>';
    });
    html += '</div>';

    html += '<p class="exam-src-note" style="margin-top:var(--space-6)">' +
      (isPredict(e) ? '예상 모의고사는 기출 분석 기반 자체 제작 문항입니다.' : '출제: 한국교육과정평가원 · ') +
      '복습은 단원별 개념 정리와 오답 노트를 활용해 보세요.</p>';

    view.innerHTML = html;

    view.querySelector('[data-exam-again]').addEventListener('click', function () { startExam(state.examId); });
    view.querySelector('[data-export-ai]').addEventListener('click', function (event) {
      downloadAiReviewReport(event.currentTarget);
    });
    view.querySelector('[data-exam-list]').addEventListener('click', function () {
      if (window.AppUI) window.AppUI.show('exam');
    });
  }

  function readBlobAsDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('이미지를 읽지 못했습니다.')); };
      reader.readAsDataURL(blob);
    });
  }

  function readImageSize(dataUrl) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
      image.onerror = function () { reject(new Error('문제 이미지 크기를 확인하지 못했습니다.')); };
      image.src = dataUrl;
    });
  }

  function handwritingSvg(strokes, imageWidth, imageHeight) {
    var paths = [];
    (strokes || []).forEach(function (stroke) {
      var rect = stroke && stroke.ir;
      if (!rect || !Array.isArray(stroke.p) || !stroke.p.length ||
          !(Number(rect.w) > 0) || !(Number(rect.h) > 0)) return;
      var scaleX = imageWidth / Number(rect.w);
      var scaleY = imageHeight / Number(rect.h);
      var points = stroke.p.map(function (point) {
        return [
          (Number(point[0]) - Number(rect.x)) * scaleX,
          (Number(point[1]) - Number(rect.y)) * scaleY
        ];
      }).filter(function (point) {
        return Number.isFinite(point[0]) && Number.isFinite(point[1]);
      });
      if (!points.length) return;
      var d = points.map(function (point, index) {
        return (index ? 'L' : 'M') + point[0].toFixed(2) + ' ' + point[1].toFixed(2);
      }).join(' ');
      var surfaceWidth = Number(stroke.w) || Number(rect.w);
      var cssWidth = stroke.t === 'e'
        ? Math.max(26, surfaceWidth / 38)
        : Math.max(2.8, surfaceWidth / 480);
      var lineWidth = cssWidth * scaleX;
      var color = stroke.t === 'e' ? '#ffffff' : (/^#[0-9a-f]{6}$/i.test(stroke.c || '') ? stroke.c : '#2563eb');
      paths.push('<path d="' + d + '" fill="none" stroke="' + color +
        '" stroke-width="' + lineWidth.toFixed(2) +
        '" stroke-linecap="round" stroke-linejoin="round"/>');
      if (points.length === 1) {
        paths.push('<circle cx="' + points[0][0].toFixed(2) + '" cy="' + points[0][1].toFixed(2) +
          '" r="' + (lineWidth / 2).toFixed(2) + '" fill="' + color + '"/>');
      }
    });
    if (!paths.length) return '';
    return '<svg class="ink-overlay" viewBox="0 0 ' + imageWidth + ' ' + imageHeight +
      '" xmlns="http://www.w3.org/2000/svg" aria-label="문제 위에 작성한 손필기">' + paths.join('') + '</svg>';
  }

  async function downloadAiReviewReport(button) {
    var exam = examById(state.examId);
    if (!exam) return;
    var originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = '보고서 생성 중…';
    try {
      var results = [];
      var cards = [];
      for (var i = 0; i < exam.questions.length; i++) {
        var question = exam.questions[i];
        var selected = state.answers[i];
        var included = includedIdx(exam).indexOf(i) !== -1;
        var evaluation = window.AssessmentEngine.evaluateResponse(question, selected);
        var correct = included && evaluation.status === 'correct';
        var strokes = Array.isArray(state.strokes[i]) ? state.strokes[i] : [];
        var stimulus = question.stimulus || null;
        var stimulusAssets = stimulus && Array.isArray(stimulus.assets) ? stimulus.assets : [];
        var imagePath = stimulus && stimulus.type === 'image'
          ? (stimulus.src || stimulus.url || stimulusAssets[0] || '')
          : '';
        if (imagePath && typeof imagePath === 'object') imagePath = imagePath.url || imagePath.src || '';
        var imageData = null;
        var overlay = '';
        var imageEmbedded = false;

        if (imagePath) {
          var response = await fetch(imagePath, { cache: 'force-cache' });
          if (!response.ok) throw new Error((question.n) + '번 문제 이미지를 불러오지 못했습니다.');
          imageData = await readBlobAsDataUrl(await response.blob());
          var dimensions = await readImageSize(imageData);
          overlay = handwritingSvg(strokes, dimensions.width, dimensions.height);
          imageEmbedded = true;
        }

        results.push({
          number: question.number || question.n,
          itemType: question.itemType,
          responseType: question.responseType,
          points: question.points || question.pts || 0,
          included: included,
          response: selected === undefined ? null : selected,
          selectedResponse: formattedResponse(question, selected),
          answerKey: question.answerKey,
          correctAnswer: formattedAnswer(question),
          result: !included ? 'excluded' : evaluation.status,
          handwriting: strokes,
          handwritingOverlayIncluded: !!overlay,
          imageEmbedded: imageEmbedded,
          stimulus: stimulus,
          prompt: question.prompt || question.q || null,
          choices: question.options || question.c || null,
          explanation: question.explanation || question.e || null,
          conceptUnit: question.u || null
        });

        var questionBody = imageData
          ? '<div class="sheet"><img src="' + imageData + '" alt="' + question.n +
            '번 문제 원본"/>' + overlay + '</div>'
          : questionStimulusHtml(question, exam, i);
        questionBody += reviewChoiceHtml(question, selected);
        if (strokes.length && !overlay && imagePath) {
          questionBody += '<p class="note">필기는 벡터 좌표로 포함했지만, 이 획은 작성 당시 문제 이미지 좌표 정보가 없어 이미지 위에 겹쳐 표시하지 못했습니다.</p>';
        }
        if (question.explanation || question.e) {
          questionBody += '<div class="explanation"><b>기존 해설</b><p>' +
            (question.explanation || question.e) + '</p></div>';
        }
        var selectedText = formattedResponse(question, selected);
        var correctText = formattedAnswer(question);
        var verdict = !included ? '제외' :
          (evaluation.status === 'pending-manual' ? '채점 대기' :
            (evaluation.status === 'unanswered' ? '미응답' : (correct ? '정답' : '오답')));
        cards.push('<section class="question"><h2>' + (question.number || question.n) + '번 · ' + verdict +
          '</h2><p>내 답안: <b>' + esc2(selectedText) + '</b> · 정답: <b>' + esc2(correctText) +
          '</b> · 배점: ' + (question.points || question.pts || 0) + '점</p>' + questionBody + '</section>');
      }

      var score = scoreExam(exam);
      var payload = {
        schema: 'study-notes-ai-review/v1',
        exportedAt: new Date().toISOString(),
        exam: { id: exam.id, label: exam.label, year: exam.year, kind: exam.kind },
        score: score,
        instructions: [
          '각 오답을 문제 원문과 내 손필기를 근거로 분석하세요.',
          '내가 선택한 선지가 왜 틀렸는지, 정답의 근거가 무엇인지 설명하세요.',
          '부족한 개념 또는 영어 독해 기능을 문항별로 분류하고, 반복되는 약점을 요약하세요.',
          '자료에서 확인할 수 없는 생각이나 실수 원인은 추측하지 말고 가능성으로 표시하세요.'
        ],
        questions: results
      };
      var json = JSON.stringify(payload).replace(/</g, '\\u003c');
      var reportHtml = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>AI 오답 분석 보고서 - ' + esc2(exam.label) + '</title><style>' +
        'body{font-family:system-ui,sans-serif;max-width:980px;margin:24px auto;padding:0 16px;color:#20242b;line-height:1.55}' +
        'h1{font-size:24px}.summary,.question{border:1px solid #d9dee8;border-radius:12px;padding:16px;margin:16px 0}' +
        '.sheet{position:relative;display:inline-block;max-width:100%;line-height:0}.sheet img{display:block;max-width:100%;height:auto}' +
        '.ink-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}' +
        '.choices{padding-left:28px}.choices li{padding:5px}.choices li.correct{font-weight:700;color:#16834a}.choices li.selected{outline:1px solid #c33;border-radius:5px}' +
        '.explanation{background:#f5f7fa;padding:12px;border-radius:8px}.note{color:#8a5a00}.prompt{margin:12px 0}' +
        '</style></head><body><h1>학습노트 · AI 오답 분석 보고서</h1>' +
        '<div class="summary"><h2>' + esc2(exam.label) + '</h2><p>점수: ' + score.score + '/' + score.max +
        ' · 정답: ' + score.correct + '/' + score.total + ' · 미응답: ' + score.blank + '</p>' +
        '<h3>AI 분석 요청</h3><ol>' + payload.instructions.map(function (line) { return '<li>' + esc2(line) + '</li>'; }).join('') +
        '</ol><p>각 문항의 이미지·답안·저장된 손필기를 함께 확인하세요.</p></div>' +
        cards.join('') + '<script type="application/json" id="study-notes-ai-data">' + json +
        '<\\/script></body></html>';
      var blob = new Blob([reportHtml], { type: 'text/html;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = exam.id + '-AI-review.html';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    } catch (error) {
      window.alert('AI 분석 보고서를 만들지 못했습니다: ' + (error && error.message ? error.message : String(error)));
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }

  function examResultMsg(pct) {
    if (pct === 100) return '만점입니다. 실전 감각이 완벽해요.';
    if (pct >= 90) return '훌륭합니다. 놓친 배점만 골라 복습해요.';
    if (pct >= 75) return '좋은 성적이에요. 오답 문항의 개념을 짚어보세요.';
    if (pct >= 55) return '무난한 성적이에요. 3점 문항 위주로 다시 풀어보세요.';
    return '기초 개념부터 다잡고 다시 도전해 보세요.';
  }

  function esc2(s) {
    return String(s).replace(/&/g, '&' + 'amp;').replace(/</g, '&' + 'lt;').replace(/>/g, '&' + 'gt;').replace(/"/g, '&' + 'quot;');
  }

  window.ExamUI = {
    renderPicker: renderPicker,
    renderRun: renderRun,
    renderResult: renderResult,
    getWrongNotes: getExamWrongNotes,
    removeWrongNote: removeExamWrongNote,
    clearWrongNotes: clearExamWrongNotes,
    retryExam: retryExam,
    cleanup: function () {
      stopTimer();
      var runView = document.getElementById('view-examrun');
      if (runView && runView._penToolsCleanup) runView._penToolsCleanup();
    },
  };
})();
