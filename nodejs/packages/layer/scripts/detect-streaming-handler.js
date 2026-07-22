const fs = require('fs');
const path = require('path');

const appRoot = process.env.LAMBDA_TASK_ROOT;
const handlerString = process.env.HANDLER_STRING;
const outputPrefix = '__CX_STREAMING_METADATA__';

function splitHandlerString(handler) {
  const lastDot = handler.lastIndexOf('.');
  if (lastDot === -1 || lastDot === handler.length - 1) {
    throw new Error(`Handler "${handler}" must be in "module.handler" format.`);
  }

  return [handler.slice(0, lastDot), handler.slice(lastDot + 1)];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isJavaScriptFile(file) {
  return ['.js', '.cjs', '.mjs'].includes(path.extname(file));
}

function resolveFile(base) {
  for (const candidate of [
    base,
    `${base}.js`,
    `${base}.cjs`,
    `${base}.mjs`,
    path.join(base, 'index.js'),
    path.join(base, 'index.cjs'),
    path.join(base, 'index.mjs'),
  ]) {
    try {
      if (fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch (_) {}
  }

  return undefined;
}

function resolveModuleFile(modulePath) {
  try {
    return require.resolve(modulePath, { paths: [appRoot] });
  } catch (err) {
    if (err?.code !== 'MODULE_NOT_FOUND') {
      throw err;
    }
  }

  return resolveFile(modulePath) || modulePath;
}

function resolveDependency(fromFile, specifier) {
  if (!specifier || specifier.startsWith('node:')) {
    return undefined;
  }

  if (specifier.startsWith('.')) {
    return resolveFile(path.resolve(path.dirname(fromFile), specifier));
  }

  try {
    return require.resolve(specifier, {
      paths: [path.dirname(fromFile), appRoot],
    });
  } catch (_) {
    return undefined;
  }
}

function stripCommentsAndStrings(source) {
  const output = new Array(source.length);
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        output[index] = ' ';
        index++;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      output[index] = ' ';
      output[index + 1] = ' ';
      index += 2;
      while (
        index < source.length &&
        !(source[index] === '*' && source[index + 1] === '/')
      ) {
        output[index] = source[index] === '\n' ? '\n' : ' ';
        index++;
      }
      if (index < source.length) {
        output[index] = ' ';
        output[index + 1] = ' ';
        index += 2;
      }
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      output[index] = ' ';
      index++;
      while (index < source.length) {
        if (source[index] === '\\') {
          output[index] = ' ';
          output[index + 1] = ' ';
          index += 2;
          continue;
        }
        if (source[index] === char) {
          output[index] = ' ';
          index++;
          break;
        }
        output[index] = source[index] === '\n' ? '\n' : ' ';
        index++;
      }
      continue;
    }

    output[index] = char;
    index++;
  }

  return output.join('');
}

function findMatchingDelimiter(source, start, open, close) {
  let depth = 0;

  for (let index = start; index < source.length; index++) {
    if (source[index] === open) {
      depth++;
    } else if (source[index] === close) {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function findStatementEnd(source, start) {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (char === '(') {
      parenDepth++;
    } else if (char === ')') {
      parenDepth--;
    } else if (char === '{') {
      braceDepth++;
    } else if (char === '}') {
      braceDepth--;
    } else if (char === '[') {
      bracketDepth++;
    } else if (char === ']') {
      bracketDepth--;
    } else if (
      char === ';' &&
      parenDepth === 0 &&
      braceDepth === 0 &&
      bracketDepth === 0
    ) {
      return index;
    }
  }

  return source.length;
}

function splitTopLevelArguments(source) {
  const values = [];
  let start = 0;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '(') {
      parenDepth++;
    } else if (char === ')') {
      parenDepth--;
    } else if (char === '{') {
      braceDepth++;
    } else if (char === '}') {
      braceDepth--;
    } else if (char === '[') {
      bracketDepth++;
    } else if (char === ']') {
      bracketDepth--;
    } else if (
      char === ',' &&
      parenDepth === 0 &&
      braceDepth === 0 &&
      bracketDepth === 0
    ) {
      values.push(source.slice(start, index));
      start = index + 1;
    }
  }

  values.push(source.slice(start));
  return values;
}

function trimExpression(value) {
  let expression = value.trim();

  while (
    expression.startsWith('(') &&
    expression.endsWith(')') &&
    findMatchingDelimiter(expression, 0, '(', ')') === expression.length - 1
  ) {
    expression = expression.slice(1, -1).trim();
  }

  return expression;
}

function parseSpecifierList(value) {
  return value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const propertyMatch = part.match(
        /^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)$/
      );
      if (propertyMatch) {
        return {
          importedName: propertyMatch[1],
          localName: propertyMatch[2],
        };
      }

      const aliasMatch = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (aliasMatch) {
        return {
          importedName: aliasMatch[1],
          localName: aliasMatch[2],
        };
      }

      return {
        importedName: part,
        localName: part,
      };
    });
}

function extractHighWaterMark(expression) {
  const openParen = expression.indexOf('(');
  const closeParen = expression.lastIndexOf(')');
  if (openParen === -1 || closeParen <= openParen) {
    return undefined;
  }

  const options = splitTopLevelArguments(
    expression.slice(openParen + 1, closeParen)
  )[1];
  const match = options?.match(/\bhighWaterMark\s*:\s*([1-9][0-9]*)\b/);
  if (!match) {
    return undefined;
  }

  return Number(match[1]);
}

function isDirectStreamifyCall(expression) {
  return /^(?:awslambda\s*\.\s*)?streamifyResponse\s*\(/.test(expression);
}

function readModule(file) {
  try {
    const source = fs.readFileSync(file, 'utf8');
    return {
      file,
      source,
      code: stripCommentsAndStrings(source),
    };
  } catch (_) {
    return undefined;
  }
}

function findAssignmentExpression(code, prefix, name) {
  const pattern = new RegExp(`${prefix}${escapeRegExp(name)}\\s*=\\s*`, 'g');
  let match;

  while ((match = pattern.exec(code)) !== null) {
    const start = match.index + match[0].length;
    const end = findStatementEnd(code, start);
    const expression = trimExpression(code.slice(start, end));
    if (expression) {
      return expression;
    }
  }

  return undefined;
}

function findModuleExportsObjectProperty(code, name) {
  const objectPattern = /module\s*\.\s*exports\s*=\s*\{/g;
  const propertyPattern = new RegExp(
    `(?:^|,)\\s*(?:['"]${escapeRegExp(name)}['"]|${escapeRegExp(
      name
    )})\\s*:`,
    'g'
  );
  let match;

  while ((match = objectPattern.exec(code)) !== null) {
    const objectStart = code.indexOf('{', match.index);
    const objectEnd = findMatchingDelimiter(code, objectStart, '{', '}');
    if (objectEnd === -1) {
      continue;
    }

    const body = code.slice(objectStart + 1, objectEnd);
    let propertyMatch;
    while ((propertyMatch = propertyPattern.exec(body)) !== null) {
      const valueStart = propertyMatch.index + propertyMatch[0].length;
      const valueEnd = findStatementEnd(body, valueStart);
      const expression = trimExpression(body.slice(valueStart, valueEnd));
      if (expression) {
        return expression;
      }
    }

    objectPattern.lastIndex = objectEnd + 1;
  }

  return undefined;
}

function findExportedExpression(module, exportName) {
  const { code } = module;

  return (
    findAssignmentExpression(code, '(?:module\\s*\\.\\s*)?exports\\s*\\.\\s*', exportName) ||
    findModuleExportsObjectProperty(code, exportName) ||
    findAssignmentExpression(code, 'export\\s+(?:const|let|var)\\s+', exportName)
  );
}

function findExportedAlias(module, exportName) {
  const pattern = /export\s*\{([^}]*)\}(?:\s+from\s+['"]([^'"]+)['"])?/g;
  let match;

  while ((match = pattern.exec(module.source)) !== null) {
    for (const specifier of parseSpecifierList(match[1])) {
      if (specifier.localName !== exportName) {
        continue;
      }

      if (match[2]) {
        return {
          kind: 'imported',
          exportName: specifier.importedName,
          file: resolveDependency(module.file, match[2]),
        };
      }

      return { kind: 'local', name: specifier.importedName };
    }
  }

  return undefined;
}

function findRequirePropertyBinding(module, localName) {
  const direct = new RegExp(
    `(?:const|let|var)\\s+${escapeRegExp(
      localName
    )}\\s*=\\s*require\\(\\s*['"]([^'"]+)['"]\\s*\\)\\s*\\.\\s*([A-Za-z_$][\\w$]*)`,
    'g'
  ).exec(module.source);
  if (direct) {
    return {
      kind: 'imported',
      exportName: direct[2],
      file: resolveDependency(module.file, direct[1]),
    };
  }

  const destructuredPattern =
    /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;

  while ((match = destructuredPattern.exec(module.source)) !== null) {
    for (const specifier of parseSpecifierList(match[1])) {
      if (specifier.localName === localName) {
        return {
          kind: 'imported',
          exportName: specifier.importedName,
          file: resolveDependency(module.file, match[2]),
        };
      }
    }
  }

  return undefined;
}

function findImportBinding(module, localName) {
  const pattern = /import\s*\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g;
  let match;

  while ((match = pattern.exec(module.source)) !== null) {
    for (const specifier of parseSpecifierList(match[1])) {
      if (specifier.localName === localName) {
        return {
          kind: 'imported',
          exportName: specifier.importedName,
          file: resolveDependency(module.file, match[2]),
        };
      }
    }
  }

  return undefined;
}

function findLocalExpression(module, localName) {
  const expression = findAssignmentExpression(
    module.code,
    '(?:const|let|var)\\s+',
    localName
  );
  if (expression) {
    return { kind: 'expression', expression };
  }

  return (
    findRequirePropertyBinding(module, localName) || findImportBinding(module, localName)
  );
}

function resolveExpression(module, expression, seen) {
  const trimmed = trimExpression(expression);
  if (!trimmed) {
    return { streaming: false };
  }

  if (isDirectStreamifyCall(trimmed)) {
    return {
      streaming: true,
      highWaterMark: extractHighWaterMark(trimmed),
    };
  }

  const requireProperty = trimmed.match(
    /^require\(\s*['"]([^'"]+)['"]\s*\)\s*\.\s*([A-Za-z_$][\w$]*)$/
  );
  if (requireProperty) {
    const importedFile = resolveDependency(module.file, requireProperty[1]);
    return resolveExport(importedFile, requireProperty[2], seen);
  }

  const identifier = trimmed.match(/^[A-Za-z_$][\w$]*$/);
  if (!identifier) {
    return { streaming: false };
  }

  return resolveLocal(module, identifier[0], seen);
}

function resolveLocal(module, localName, seen) {
  const binding = findLocalExpression(module, localName);
  if (!binding) {
    return { streaming: false };
  }

  if (binding.kind === 'expression') {
    return resolveExpression(module, binding.expression, seen);
  }

  return resolveExport(binding.file, binding.exportName, seen);
}

function resolveExport(file, exportName, seen = new Set()) {
  if (!file || !isJavaScriptFile(file)) {
    return { streaming: false };
  }

  const key = `${file}:${exportName}`;
  if (seen.has(key)) {
    return { streaming: false };
  }
  seen.add(key);

  const module = readModule(file);
  if (!module) {
    return { streaming: false };
  }

  const expression = findExportedExpression(module, exportName);
  if (expression) {
    return resolveExpression(module, expression, seen);
  }

  const alias = findExportedAlias(module, exportName);
  if (!alias) {
    return { streaming: false };
  }

  if (alias.kind === 'local') {
    return resolveLocal(module, alias.name, seen);
  }

  return resolveExport(alias.file, alias.exportName, seen);
}

function main() {
  try {
    const [modulePath, exportName] = splitHandlerString(handlerString);
    const entryFile = resolveModuleFile(path.resolve(appRoot, modulePath));
    const metadata = resolveExport(entryFile, exportName);
    if (metadata.streaming) {
      console.log(`${outputPrefix}${JSON.stringify(metadata)}`);
    }
  } catch (_) {}
}

main();
