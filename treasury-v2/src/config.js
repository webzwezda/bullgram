const DEFAULT_APP_ORIGIN = 'https://bullgram.xyz';

function getRuntimeOrigin() {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return DEFAULT_APP_ORIGIN;
  }
  return window.location.origin.replace(/\/$/, '');
}

const runtimeOrigin = getRuntimeOrigin();

export const APP_CONFIG = {
  supabaseUrl: runtimeOrigin,
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIn0.zdTXRg3mD4-LmP3l6Dsf68nrtoBVEscvDPxMeWIE7ME',
  backendUrl: runtimeOrigin
};
