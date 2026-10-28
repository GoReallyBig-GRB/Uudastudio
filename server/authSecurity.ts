export function isDevAuthBypassEnabled(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  configuredFlag?: string
): boolean {
  const flag = arguments.length > 1 ? configuredFlag : process.env.DEV_AUTH_BYPASS;
  return flag === 'true' && nodeEnv !== 'production';
}
