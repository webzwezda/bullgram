const DEFAULT_APP_ORIGIN = 'https://bullrun.ru';

function getRuntimeOrigin() {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return DEFAULT_APP_ORIGIN;
  }
  return window.location.origin.replace(/\/$/, '');
}

const runtimeOrigin = getRuntimeOrigin();

export const APP_CONFIG = {
  supabaseUrl: runtimeOrigin,
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIn0.S88_k_U0Nl7yWjXq5p_jX8U0Nl7yWjXq5p_jX8U0Nl7',
  backendUrl: runtimeOrigin
};
