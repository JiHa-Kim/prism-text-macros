window.MathJax = {
  tex: {
    inlineMath: [['$', '$'], ['\\(', '\\)']],
    displayMath: [['$$', '$$'], ['\\[', '\\]']],
    processEscapes: true,
    packages: {'[+]': ['noerrors', 'noundefined', 'color', 'textmacros', 'mathtools', 'physics', 'braket']} 
  },
  loader: {
    load: ['[tex]/noerrors', '[tex]/noundefined', '[tex]/color', '[tex]/textmacros', '[tex]/mathtools', '[tex]/physics', '[tex]/braket']
  },
  options: {
    enableMenu: false
  },
  startup: {
    typeset: false
  }
};
