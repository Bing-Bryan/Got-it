/** Bounded arithmetic only. No eval, variables, functions, file or network access. */
export function calculate(expression: string): number {
  if (!expression.trim() || expression.length > 200) throw new Error('表达式为空或过长');
  const tokens = expression.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|\*\*|[()+\-*/^]|\S/g) ?? [];
  let pos = 0;
  function parse(min = 0, depth = 0): number {
    if (depth > 32) throw new Error('表达式嵌套过深');
    const token = tokens[pos++];
    let left: number;
    if (token === '+' || token === '-') left = (token === '-' ? -1 : 1) * parse(3, depth + 1);
    else if (token === '(') { left = parse(0, depth + 1); if (tokens[pos++] !== ')') throw new Error('括号不完整'); }
    else { if (!token || !/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token)) throw new Error('只支持数值及加减乘除、括号、幂'); left = Number(token); }
    while (pos < tokens.length) {
      const op = tokens[pos], rank = op === '+' || op === '-' ? 1 : op === '*' || op === '/' ? 2 : op === '^' || op === '**' ? 3 : 0;
      if (!rank || rank < min) break;
      pos++;
      const right = parse(rank + (rank === 3 ? 0 : 1), depth + 1);
      left = op === '+' ? left + right : op === '-' ? left - right : op === '*' ? left * right : op === '/' ? left / right : left ** right;
      if (!Number.isFinite(left)) throw new Error('计算结果不是有限数值');
    }
    if (!Number.isFinite(left)) throw new Error('数值超出范围');
    return left;
  }
  const result = parse();
  if (pos !== tokens.length) throw new Error('包含不支持的计算内容');
  return result;
}

export function withCalculation(answer: string, value: unknown): string {
  if (!value || typeof value !== 'object') return answer.replaceAll('{{计算结果}}', '（未提供可执行的计算式）');
  const { expression, unit } = value as {expression?:unknown;unit?:unknown};
  try {
    if (typeof expression !== 'string') throw new Error('缺少计算式');
    const result = Number(calculate(expression).toPrecision(10)).toString();
    const suffix = typeof unit === 'string' ? unit.replace(/[^\p{L}\p{N}%‰ ./$¥€-]/gu, '').slice(0, 30) : '';
    return answer.replaceAll('{{计算结果}}', result + suffix) + `\n\n**计算结果：** ${result}${suffix}\n\n计算式：\`${expression}\`\n\n按上述输入实际计算；这不代表原文中的输入数据已核实。`;
  } catch (error) {
    return answer.replaceAll('{{计算结果}}', '（计算未完成）') + '\n\n**计算未完成：** ' + (error instanceof Error ? error.message : '不支持的计算') + '。请补充或调整数值与计算方式。';
  }
}
