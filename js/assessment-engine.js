/* 학습노트 — 과목 독립 평가/문항 엔진
   문항 표현(prompt/stimulus)과 응답·채점 방식(responseType)을 분리합니다.
   과목별 파일은 콘텐츠 데이터만 제공하고, 이 모듈은 정규화·검증·채점을 담당합니다. */
(function (global) {
  'use strict';

  var RESPONSE_TYPES = [
    'single-choice',
    'multiple-select',
    'short-answer',
    'numeric',
    'essay',
    'code'
  ];
  var STIMULUS_TYPES = ['text', 'html', 'image', 'audio', 'table', 'chart', 'math', 'code'];

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function copyArray(value) {
    return Array.isArray(value) ? value.slice() : [];
  }

  function inferResponseType(question) {
    if (question.responseType) return question.responseType;
    if (question.itemType) return question.itemType;
    if (Array.isArray(question.c) || Array.isArray(question.options)) return 'single-choice';
    var legacyAnswer = getAnswerKey(question);
    if (typeof legacyAnswer === 'number' && Number.isInteger(legacyAnswer)) return 'single-choice';
    return 'short-answer';
  }

  function normalizeOptions(question) {
    var source = Array.isArray(question.options) ? question.options : question.c;
    if (!Array.isArray(source)) return [];
    return source.map(function (option, index) {
      if (option && typeof option === 'object') {
        return {
          id: String(option.id !== undefined ? option.id : 'option-' + index),
          content: String(option.content !== undefined ? option.content : option.text || ''),
          label: option.label !== undefined ? String(option.label) : ''
        };
      }
      return { id: 'option-' + index, content: String(option), label: '' };
    });
  }

  function getAnswerKey(question) {
    if (hasOwn(question, 'answerKey')) return question.answerKey;
    if (hasOwn(question, 'correctAnswer')) return question.correctAnswer;
    if (hasOwn(question, 'ans')) return question.ans;
    if (hasOwn(question, 'a')) return question.a;
    if (hasOwn(question, 'acceptableAnswers')) return copyArray(question.acceptableAnswers);
    return null;
  }

  function normalizeStimulus(question) {
    var stimulus = question.stimulus;
    if (stimulus == null && Array.isArray(question.assets) && question.assets.length) {
      stimulus = { type: question.assetType || question.mediaType || 'image', assets: question.assets.slice() };
    }
    if (stimulus == null && (question.image || question.imageUrl || question.imagePath)) {
      stimulus = {
        type: 'image',
        assets: [question.image || question.imageUrl || question.imagePath]
      };
    }
    if (stimulus == null) return null;
    if (typeof stimulus === 'string') return { type: 'html', content: stimulus };
    if (Array.isArray(stimulus)) return { type: 'html', content: stimulus.slice() };
    var copy = {};
    Object.keys(stimulus).forEach(function (key) { copy[key] = stimulus[key]; });
    copy.type = copy.type || 'html';
    return copy;
  }

  function normalizeQuestion(question, assessment) {
    if (!question || typeof question !== 'object') {
      throw new TypeError('Question must be an object.');
    }
    var responseType = inferResponseType(question);
    if (RESPONSE_TYPES.indexOf(responseType) === -1) {
      throw new TypeError('Unsupported responseType: ' + responseType);
    }
    var options = normalizeOptions(question);
    var answerKey = getAnswerKey(question);
    if (responseType === 'single-choice' && !options.length &&
        typeof answerKey === 'number' && Number.isInteger(answerKey) && answerKey >= 0 && answerKey <= 4) {
      options = [0, 1, 2, 3, 4].map(function (index) {
        return { id: 'option-' + index, content: '', label: '' };
      });
    }
    var points = Number(question.points !== undefined ? question.points : question.pts);
    if (!Number.isFinite(points) || points < 0) points = 0;

    var normalized = {};
    Object.keys(question).forEach(function (key) { normalized[key] = question[key]; });
    normalized.schemaVersion = 1;
    normalized.id = String(question.id !== undefined ? question.id :
      (question.n !== undefined ? question.n : ''));
    normalized.number = Number(question.number !== undefined ? question.number : question.n);
    normalized.itemType = responseType;
    normalized.responseType = responseType;
    normalized.prompt = question.prompt !== undefined ? question.prompt : (question.q || '');
    normalized.promptFormat = question.promptFormat || (typeof normalized.prompt === 'string' ? 'html' : 'text');
    normalized.stimulus = normalizeStimulus(question);
    normalized.options = options;
    normalized.answerKey = answerKey;
    normalized.points = points;
    normalized.explanation = question.explanation !== undefined ? question.explanation : (question.e || '');

    if (assessment && assessment.id && normalized.number && !normalized.stimulus &&
        assessment.questionImagePattern) {
      normalized.stimulus = {
        type: 'image',
        assets: [assessment.questionImagePattern
          .replace('{assessmentId}', assessment.id)
          .replace('{number}', String(normalized.number).padStart(2, '0'))]
      };
    }

    return normalized;
  }

  function normalizeAssessment(assessment, options) {
    if (!assessment || typeof assessment !== 'object') {
      throw new TypeError('Assessment must be an object.');
    }
    options = options || {};
    var sourceQuestions = Array.isArray(assessment.questions)
      ? assessment.questions
      : (Array.isArray(assessment.items) ? assessment.items : null);
    if (!sourceQuestions) throw new TypeError('Assessment must provide questions or items.');

    var normalized = {};
    Object.keys(assessment).forEach(function (key) { normalized[key] = assessment[key]; });
    normalized.schemaVersion = 1;
    normalized.courseId = options.courseId || assessment.courseId || '';
    normalized.assessmentType = options.assessmentType || assessment.assessmentType || assessment.kind || 'practice';
    normalized.title = assessment.title || assessment.label || assessment.id || 'Assessment';
    normalized.durationSec = Number(options.durationSec || assessment.durationSec || 0);
    normalized.questionImagePattern = options.questionImagePattern || assessment.questionImagePattern || '';
    normalized.questions = sourceQuestions.map(function (question) {
      var item = normalizeQuestion(question, normalized);
      if (!hasOwn(item, 'ans')) item.ans = item.answerKey;
      return item;
    });
    normalized.items = normalized.questions;
    normalized.questionCount = normalized.questions.length;
    normalized.totalPoints = normalized.questions.reduce(function (total, question) {
      return total + question.points;
    }, 0);
    normalized.maxScore = Number(assessment.maxScore);
    if (!Number.isFinite(normalized.maxScore) || normalized.maxScore <= 0) normalized.maxScore = normalized.totalPoints;
    return normalized;
  }

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .normalize('NFKC')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase();
  }

  function normalizeChoiceValue(value, options) {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value === 'string') {
      var numeric = /^\d+$/.test(value) ? Number(value) : NaN;
      if (Number.isInteger(numeric)) return numeric;
      for (var i = 0; i < options.length; i += 1) {
        if (options[i].id === value) return i;
      }
    }
    return -1;
  }

  function sameSet(left, right) {
    if (left.length !== right.length) return false;
    var a = left.slice().sort();
    var b = right.slice().sort();
    for (var i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
    return true;
  }

  function result(status, question, earnedPoints, isCorrect) {
    return {
      status: status,
      isCorrect: isCorrect,
      earnedPoints: earnedPoints,
      maxPoints: question.points
    };
  }

  function evaluateResponse(question, response, manualGrade) {
    var q = question && question.schemaVersion === 1 ? question : normalizeQuestion(question || {});
    if (response === null || response === undefined || response === '' ||
        (q.responseType === 'multiple-select' && Array.isArray(response) && response.length === 0) ||
        (q.responseType === 'short-answer' && normalizeText(response) === '') ||
        (q.responseType === 'numeric' && String(response).trim() === '') ||
        ((q.responseType === 'essay' || q.responseType === 'code') && String(response).trim() === '')) {
      return result('unanswered', q, 0, false);
    }

    if (q.responseType === 'essay' || q.responseType === 'code') {
      if (manualGrade && isFiniteNumber(Number(manualGrade.earnedPoints))) {
        var earned = Math.max(0, Math.min(q.points, Number(manualGrade.earnedPoints)));
        return result('graded-manual', q, earned, earned === q.points);
      }
      return result('pending-manual', q, null, null);
    }

    var correct = false;
    if (q.responseType === 'single-choice') {
      var mine = normalizeChoiceValue(response, q.options);
      var answer = normalizeChoiceValue(q.answerKey, q.options);
      correct = mine >= 0 && mine === answer;
    } else if (q.responseType === 'multiple-select') {
      var selected = Array.isArray(response) ? response : [response];
      var answerSet = Array.isArray(q.answerKey) ? q.answerKey : [];
      var selectedIndexes = selected.map(function (value) {
        return normalizeChoiceValue(value, q.options);
      });
      var answerIndexes = answerSet.map(function (value) {
        return normalizeChoiceValue(value, q.options);
      });
      correct = selectedIndexes.every(function (value) { return value >= 0; }) &&
        answerIndexes.every(function (value) { return value >= 0; }) &&
        sameSet(selectedIndexes, answerIndexes);
    } else if (q.responseType === 'short-answer') {
      var accepted = Array.isArray(q.answerKey) ? q.answerKey :
        (Array.isArray(q.acceptableAnswers) ? q.acceptableAnswers : [q.answerKey]);
      var mineText = normalizeText(response);
      correct = accepted.some(function (answerText) {
        return normalizeText(answerText) === mineText;
      });
    } else if (q.responseType === 'numeric') {
      var mineNumber = Number(String(response).replace(/,/g, '').trim());
      var expected = q.answerKey && typeof q.answerKey === 'object'
        ? Number(q.answerKey.value)
        : Number(q.answerKey);
      var tolerance = q.answerKey && typeof q.answerKey === 'object'
        ? Number(q.answerKey.tolerance || 0)
        : Number(q.numericTolerance || 0);
      correct = Number.isFinite(mineNumber) && Number.isFinite(expected) &&
        Math.abs(mineNumber - expected) <= Math.max(0, tolerance);
    }

    return result(correct ? 'correct' : 'incorrect', q, correct ? q.points : 0, correct);
  }

  function gradeAttempt(items, responses, manualGrades) {
    var totalPoints = 0;
    var earnedPoints = 0;
    var correctCount = 0;
    var pendingManual = 0;
    var unanswered = 0;
    var results = [];
    items.forEach(function (item, index) {
      var question = item && item.schemaVersion === 1 ? item : normalizeQuestion(item || {});
      var response = Array.isArray(responses) ? responses[index] : responses && responses[question.id];
      var manualGrade = manualGrades && (manualGrades[index] || manualGrades[question.id]);
      var evaluated = evaluateResponse(question, response, manualGrade);
      totalPoints += question.points;
      if (evaluated.earnedPoints !== null) earnedPoints += evaluated.earnedPoints;
      if (evaluated.isCorrect === true) correctCount += 1;
      if (evaluated.status === 'pending-manual') pendingManual += 1;
      if (evaluated.status === 'unanswered') unanswered += 1;
      results.push({
        questionId: question.id,
        number: question.number,
        responseType: question.responseType,
        status: evaluated.status,
        isCorrect: evaluated.isCorrect,
        earnedPoints: evaluated.earnedPoints,
        maxPoints: evaluated.maxPoints
      });
    });
    return {
      earnedPoints: earnedPoints,
      totalPoints: totalPoints,
      correctCount: correctCount,
      itemCount: items.length,
      pendingManualCount: pendingManual,
      unansweredCount: unanswered,
      results: results
    };
  }

  function validateQuestion(question) {
    var q = normalizeQuestion(question);
    var errors = [];
    if (!q.id) errors.push('missing-id');
    if (!q.prompt && !q.stimulus) errors.push('missing-prompt');
    if (q.points < 0) errors.push('invalid-points');
    if (q.stimulus && STIMULUS_TYPES.indexOf(q.stimulus.type) === -1) errors.push('unsupported-stimulus-type');
    if (q.responseType === 'single-choice') {
      if (q.options.length < 2) errors.push('choice-options-required');
      if (normalizeChoiceValue(q.answerKey, q.options) < 0) errors.push('invalid-choice-answer');
    }
    if (q.responseType === 'multiple-select') {
      if (q.options.length < 2) errors.push('choice-options-required');
      if (!Array.isArray(q.answerKey) || !q.answerKey.length) errors.push('multiple-answer-key-required');
    }
    if (q.responseType === 'numeric' && !(Number.isFinite(Number(q.answerKey)) ||
        (q.answerKey && Number.isFinite(Number(q.answerKey.value))))) errors.push('numeric-answer-required');
    if (q.responseType === 'essay' && !q.rubric && !q.manualReview) errors.push('essay-rubric-required');
    if (q.responseType === 'code' && !q.rubric && !q.manualReview && !q.testCases) errors.push('code-grading-config-required');
    return { valid: errors.length === 0, errors: errors, question: q };
  }

  function validateAssessment(assessment, options) {
    var normalized = assessment && assessment.schemaVersion === 1
      ? assessment
      : normalizeAssessment(assessment, options);
    var errors = [];
    if (!normalized.id) errors.push('missing-assessment-id');
    if (!normalized.courseId) errors.push('missing-course-id');
    if (!Array.isArray(normalized.questions) || !normalized.questions.length) errors.push('assessment-items-required');
    if (!Number.isFinite(normalized.durationSec) || normalized.durationSec < 0) errors.push('invalid-duration');
    var seen = {};
    (normalized.questions || []).forEach(function (question, index) {
      if (seen[question.id]) errors.push('duplicate-question-id:' + question.id);
      seen[question.id] = true;
      var validation = validateQuestion(question);
      validation.errors.forEach(function (error) {
        errors.push('question-' + index + ':' + error);
      });
    });
    return { valid: errors.length === 0, errors: errors, assessment: normalized };
  }

  global.AssessmentEngine = {
    schemaVersion: 1,
    responseTypes: RESPONSE_TYPES.slice(),
    stimulusTypes: STIMULUS_TYPES.slice(),
    normalizeQuestion: normalizeQuestion,
    normalizeAssessment: normalizeAssessment,
    evaluateResponse: evaluateResponse,
    gradeAttempt: gradeAttempt,
    validateQuestion: validateQuestion,
    validateAssessment: validateAssessment
  };
})(window);
