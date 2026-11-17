/* 호환 어댑터 — 예상 평가 데이터 원본은 courses/social-culture/assessments.js */
(function (global) {
  'use strict';
  var data = global.StudyCourseAssessments && global.StudyCourseAssessments['social-culture'];
  if (!data) throw new Error('사회·문화 평가 데이터 모듈을 불러오지 못했습니다.');
  global.SocialCultureAssessmentData = data;
})(window);

var PREDICT_EXAMS = window.SocialCultureAssessmentData.practiceExams;
