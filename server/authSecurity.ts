export function isDevAuthBypassEnabled(nodeEnv: string | undefined = process.env.NODE_ENV, configuredFlag: string | undefined = process.env.DEV_AUTH_BYPASS): boolean {
  return configuredFlag === 'true' && nodeEnv !== 'production';
}
