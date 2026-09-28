import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// react-router Navigate не умеет переходить между SPA, поэтому полный переход
// через window.location.replace с прокидом query (deep-links несут ?userbot_id= и т.п.).
export function ExternalRedirect({ to }) {
  const { search } = useLocation();
  useEffect(() => {
    window.location.replace(to + search);
  }, [to, search]);
  return null;
}
