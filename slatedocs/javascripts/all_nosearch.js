//= require ./lib/_energize
//= require ./app/_copy
//= require ./app/_toc
//= require ./app/_lang

function adjustLanguageSelectorWidth() {
  const elem = $('.dark-box > .lang-selector');
  elem.width(elem.parent().width());
}

$(function () {
  loadToc($('#toc'), '.toc-link', '.toc-list-h2', 10);
  setupLanguages($('body').data('languages'));
  $('.content').imagesLoaded(function () {
    window.recacheHeights();
    window.refreshToc();
  });

  $(window).resize(function () {
    adjustLanguageSelectorWidth();
  });
  adjustLanguageSelectorWidth();
  $('h1').each(function () {
    $(this).nextUntil('h1').addBack().wrapAll('<div class="section"></div>');
  });
  $('blockquote, .highlight').siblings('h1, h2, h3, h4, h5, h6, p, table, ul, ol, aside, dl').addClass('has-code')
});

window.onpopstate = function () {
  activateLanguage(getLanguageFromQueryString());
};
