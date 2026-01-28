window.MathJax = {
  tex: {
    inlineMath: [['$', '$'], ['\\(', '\\)']],
    displayMath: [['$$', '$$'], ['\\[', '\\]']],
    processEscapes: true,
    packages: {'[+]': ['noerrors', 'color', 'textmacros', 'mathtools', 'physics', 'braket']} 
  },
  loader: {
    load: ['[tex]/noerrors', '[tex]/color', '[tex]/textmacros', '[tex]/mathtools', '[tex]/physics', '[tex]/braket']
  },
  options: {
    enableMenu: false
  },
  startup: {
    typeset: false
  }
};
