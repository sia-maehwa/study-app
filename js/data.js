/* 과목 콘텐츠 호환 어댑터
   새 화면/엔진은 StudyCourseRegistry.getContent(courseId)를 사용합니다.
   기존 사회·문화 화면과 게임 모듈의 전역 데이터 참조는 이 어댑터로 유지합니다. */
(function (global) {
  'use strict';
  var registry = global.StudyCourseRegistry;
  var course = registry && registry.get('social-culture');
  var content = course && registry.getContent('social-culture');
  if (!content || !Array.isArray(content.units) ||
      !Array.isArray(content.questions) || !content.concepts) {
    throw new Error('사회·문화 과목 콘텐츠 모듈을 불러오지 못했습니다.');
  }
  global.StudyCourseData = content;
})(window);

var UNITS = window.StudyCourseData.units;
var QUESTIONS = window.StudyCourseData.questions;
var CONCEPTS = window.StudyCourseData.concepts;
