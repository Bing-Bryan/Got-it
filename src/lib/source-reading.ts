import type { Source, Verification } from '../types';
import { safeSourceUrl } from './evidence';

/** Verdict labels alone cannot sanitize affirmative prose, including legacy records. */
export function lacksReadingBasis(verification: Verification, sources: Source[]): boolean {
  // A partial verdict never licenses an unqualified summary, even with a matched quote.
  // Rebuild it from scope/differences instead of trying to classify arbitrary prose.
  if (verification.verdict === 'partial') return true;
  if (!['supported', 'conflicting'].includes(verification.verdict)) return false;
  const usable = (source: Source) => !!safeSourceUrl(source.url) && source.excerptKind === 'quote' && source.retrievalStatus === 'matched' && !!source.scope;
  const direct = (id: string, relation: 'supports' | 'conflicts') => sources.some(source => source.id === id && usable(source)
    && source.relation === relation && source.applicability === 'direct' && source.origin !== 'secondary'
    && ['strong', 'moderate'].includes(source.reliability ?? '') && !!source.reliabilityReasons?.length);
  if (!verification.claims.length) return true;
  if (verification.verdict === 'supported' && !verification.claims.every(claim => claim.verdict === 'supported' && claim.sourceIds.some(id => direct(id, 'supports')))) return true;
  if (verification.verdict === 'conflicting' && !verification.claims.some(claim => claim.verdict === 'conflicting' && claim.sourceIds.some(id => direct(id, 'conflicts')))) return true;
  return verification.claims.some(claim => {
    if (claim.verdict === 'supported') return !claim.sourceIds.some(id => direct(id, 'supports'));
    if (claim.verdict === 'conflicting') return !claim.sourceIds.some(id => direct(id, 'conflicts'));
    return claim.verdict === 'partial' && !claim.sourceIds.some(id => sources.some(source => source.id === id && usable(source)
      && ['supports', 'related', 'conflicts'].includes(source.relation ?? '') && ['direct', 'partial'].includes(source.applicability ?? '')));
  });
}

/** Describe checked scope records, not the rejected model verdict prose. */
export function sourceLimitations(sources: Source[], verification: Verification): string {
  const referenced = new Set(verification.claims.flatMap(claim => claim.sourceIds));
  const candidates = sources.filter(source => safeSourceUrl(source.url) && (!referenced.size || referenced.has(source.id)));
  return candidates.slice(0, 2).map(source => {
    const name = `资料「${source.title}」`;
    if (source.excerptKind !== 'quote' || source.retrievalStatus !== 'matched') {
      return `${name}的引用正文尚未核对，不能据此确认与原句对应。`;
    }
    const scope = source.scope ? `${name}记录的范围为：${source.scope}。` : `${name}缺少明确适用范围。`;
    const difference = source.differences?.length ? `口径差异记录：${source.differences.slice(0, 2).join('；')}。` : '';
    const origin = source.origin === 'secondary' ? '这是转述资料，原始出处尚未确认。' : '';
    return `${scope}${difference}${origin}`;
  }).join('') || '现有记录不足以确认资料与原句的对应关系。';
}

/** Retain useful scope restrictions without resurrecting retired workflow instructions. */
export function readingLimitText(reason: string, advice: string): string {
  const fragments = [reason, advice].flatMap(value => value.split(/[。！？；\n]+/)).map(value => value.trim()).filter(Boolean);
  const kept = [...new Set(fragments)].filter(value => !/再找一下|继续查证|继续查找|点击|重试|确认理解|已理解|等待最终|可放心阅读/.test(value));
  return kept.length ? kept.join('。') + '。' : '';
}
