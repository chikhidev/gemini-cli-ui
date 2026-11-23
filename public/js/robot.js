    // Robot Framework for highlight.js. Every rule looks at one line only, so it also works on the single lines of a
    // diff and on the pieces of a chat code block. Robot is column based: cells are separated by two or more spaces
    // (or a tab); the first cell of an indented line is a keyword call, of a column-0 line a test / keyword name.
    function robotLanguage(hljs) {
      // letters match in either case ("Suite Setup", "suite setup"), the way Robot reads them
      const ci = (w) => w.replace(/[a-z]/gi, (ch) => '[' + ch.toUpperCase() + ch.toLowerCase() + ']');
      const list = (names) => names.map(ci).join('|');
      const CELL_END = /(?=[ \t]{2,}|\t|$)/;
      const SEPARATOR = '(?:[ \\t]{2,}|\\t)';
      const VARIABLE = {className: 'variable', begin: /[$@&%]\{/, end: /\}/, contains: ['self'], relevance: 0};
      const CONTROL = 'IF|ELSE IF|ELSE|END|FOR|WHILE|TRY|EXCEPT|FINALLY|RETURN|BREAK|CONTINUE|VAR|GROUP';
      const NOT_FIRST = '[^\\s#.$@&%\\[|]';       // what the first cell of a keyword call cannot start with
      return {
        name: 'Robot Framework',
        aliases: ['robotframework', 'resource'],
        contains: [
          // *** Settings ***, *** Test Cases ***, ...
          {className: 'section', begin: new RegExp('^\\*+[ \\t]*(?:' + list(['Settings?', 'Variables?', 'Test Cases?', 'Tasks?', 'Keywords?', 'Comments?']) + ')[ \\t]*\\**[ \\t]*$')},
          hljs.COMMENT(/^[ \t]*#/, /$/),
          hljs.COMMENT(/(?:[ \t]{2,}|\t)#/, /$/),
          // Library, Resource, Suite Setup, ... at the start of a line
          {className: 'keyword', begin: new RegExp('^(?:' + list(['Library', 'Resource', 'Variables', 'Documentation', 'Metadata', 'Suite Setup', 'Suite Teardown', 'Test Setup', 'Test Teardown', 'Test Template', 'Test Timeout', 'Test Tags', 'Force Tags', 'Default Tags', 'Keyword Tags', 'Task Setup', 'Task Teardown', 'Task Template', 'Task Timeout', 'Task Tags']) + ')(?=[ \\t]{2,}|\\t|$)')},
          // [Documentation], [Tags], [Arguments], ...
          {className: 'keyword', begin: new RegExp('\\[(?:' + list(['Documentation', 'Tags', 'Setup', 'Teardown', 'Template', 'Timeout', 'Arguments', 'Return']) + ')\\]')},
          // the name of a test case / keyword / task (not indented)
          {className: 'title function_ robot_', begin: /^(?![ \t#*.|$@&%])\S/, end: CELL_END, contains: [VARIABLE]},
          // ... (a line continues the one above)
          {className: 'operator', begin: /(?<=^[ \t]+)\.\.\.(?=[ \t]|$)/},
          // IF / ELSE / END / FOR / WHILE / TRY ... as the first cell, and IN / IN RANGE ... in a FOR line
          {className: 'keyword', begin: new RegExp('(?<=^[ \\t]+)(?:' + CONTROL + ')(?=[ \\t]{2,}|\\t|$)')},
          {className: 'keyword', begin: /(?<=[ \t]{2}|\t)IN(?: RANGE| ENUMERATE| ZIP)?(?=[ \t]{2,}|\t|$)/},
          // the keyword being called: first cell of an indented line, or the one after "${x}=" assignments
          {className: 'built_in', begin: new RegExp('(?<=^[ \\t]+(?:[$@&]\\{[^}\\n]*\\}[ \\t]*=?' + SEPARATOR + ')+)' + NOT_FIRST), end: CELL_END, contains: [VARIABLE]},
          {className: 'built_in', begin: new RegExp('(?<=^[ \\t]+)(?!(?:' + CONTROL + ')(?:[ \\t]{2,}|\\t|$))' + NOT_FIRST), end: CELL_END, contains: [VARIABLE]},
          VARIABLE,
          {className: 'number', begin: /\b\d+(?:\.\d+)?(?=[ \t]|$)/, relevance: 0},
        ],
      };
    }
    if (window.hljs) hljs.registerLanguage('robot', robotLanguage);
