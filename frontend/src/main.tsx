import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { CopilotProvider } from './ai/copilotContext';
import { AuthProvider } from './features/auth/authContext';
import { FinancialDataProvider } from './features/dashboard/financialDataContext';
import { FinancialIntelligenceProvider } from './features/intelligence/financialIntelligenceContext';
import { SmartAlertPersistenceRunner } from './features/alerts/SmartAlertPersistenceRunner';
import App from './App';
import './index.css';

// Provider order matters: the data provider consumes the session (via useAuth)
// to select the production SupabaseRepository, so auth must sit above it.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <FinancialDataProvider>
          {/* Phase 4B: the Digital Twin derives ONCE per financial state change
              from the persisted data above; pages consume it via context. */}
          <FinancialIntelligenceProvider>
            <SmartAlertPersistenceRunner />
            {/* Copilot state is session-scoped UI only: it talks exclusively to
                the finwise-copilot Edge Function and consumes no repository data,
                so it sits above the router without data-layer coupling. */}
            <CopilotProvider>
              <App />
            </CopilotProvider>
          </FinancialIntelligenceProvider>
        </FinancialDataProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
