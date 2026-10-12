export type TranslationInterruption = 'cancelled' | 'connection' | 'batch-timeout' | 'round-timeout' | 'configuration-timeout';
/** Classification comes from cancellation/deadline signals, never model prose or elapsed guesses. */
export function translationInterruption(kind: TranslationInterruption) {
 const failures = {
  cancelled: {code:'translation_cancelled',message:'翻译已由停止操作中断，已保存部分可主动续译。'},
  connection: {code:'translation_connection_interrupted',message:'翻译请求连接中断，已保存部分保留，可主动续译。'},
  'batch-timeout': {code:'translation_batch_timeout',message:'本批翻译请求超时，已保存部分保留，可主动续译。'},
  'round-timeout': {code:'translation_round_timeout',message:'本轮翻译时间已用尽，已保存部分保留，可主动续译。'},
  'configuration-timeout': {code:'translation_config_timeout',message:'本批翻译达到当前请求超时配置的限制，已保存部分保留，可主动续译。'},
 };
 return failures[kind];
}
export const timedOut = (reason: unknown) => !!reason && typeof reason === 'object' && 'code' in reason && reason.code === 'ETIMEDOUT';
