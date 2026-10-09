import { expect, it } from 'vitest';
import { calculate, withCalculation } from './reading-calculation';
it.each([['2+3*4',14],['(2+3)*4',20],['2**3**2',512],['-2^2',-4],['2^-2',.25],['.5 + 1e-2',.51]])('evaluates arithmetic %s', (expression,value)=>expect(calculate(expression as string)).toBeCloseTo(value as number));
it('executes CAGR instead of trusting the model numeric answer',()=>{
 const answer=withCalculation('年复合增长率为 {{计算结果}}',{expression:'((548/84)^(1/10)-1)*100',unit:'%'});
 expect(answer).toContain('20.62855549');expect(answer).toContain('实际计算');expect(answer).not.toContain('{{计算结果}}');
});
it.each(['1/0','2**10000','process.exit()','1;alert(1)','Math.random()','2 3','(2+3','NaN','1e999','('.repeat(40)+'1'+')'.repeat(40)])('rejects unsafe or invalid arithmetic %s',expression=>expect(()=>calculate(expression)).toThrow());
it('clearly labels unsupported calculation without claiming completion',()=>expect(withCalculation('结果 {{计算结果}}',{expression:'sqrt(2)'})).toContain('计算未完成'));
