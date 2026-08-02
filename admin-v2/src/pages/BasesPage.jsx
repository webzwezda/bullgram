import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { AudiencePanel } from './bases/AudiencePanel.jsx';
import { ClientBasesPanel } from './bases/ClientBasesPanel.jsx';

export function BasesPage() {
  const { accessToken } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeBaseId = searchParams.get('base') || '';

  const [addToBaseRequest, setAddToBaseRequest] = useState(null);

  const setActiveBaseId = useCallback((id) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('base', id);
    else next.delete('base');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  function handleAddToBase(member) {
    setAddToBaseRequest({ source: 'audience', member, nonce: Date.now() });
  }

  function consumeAddRequest() {
    setAddToBaseRequest(null);
  }

  return (
    <section className="page page--flush space-y-6">
      <AudiencePanel
        accessToken={accessToken}
        onAddToBase={handleAddToBase}
      />
      <ClientBasesPanel
        accessToken={accessToken}
        activeBaseId={activeBaseId}
        onChangeActiveBaseId={setActiveBaseId}
        addToBaseRequest={addToBaseRequest}
        onConsumeAddRequest={consumeAddRequest}
      />
    </section>
  );
}
