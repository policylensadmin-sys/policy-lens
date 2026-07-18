import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { RoleRoute } from './components/RoleRoute';
import { PublicLayout } from './layouts/PublicLayout';
import { CustomerLayout } from './layouts/CustomerLayout';
import { BrokerLayout } from './layouts/BrokerLayout';
import { Placeholder, NotAuthorized } from './pages/_placeholder';
import { Landing } from './pages/public/Landing';
import { Login } from './pages/public/Login';
import { Signup } from './pages/public/Signup';
import { Try } from './pages/public/Try';
import { Upload } from './pages/customer/Upload';
import { PolicyDashboard } from './pages/customer/PolicyDashboard';
import { PolicyChat } from './pages/customer/PolicyChat';
import { Upgrade } from './pages/customer/Upgrade';
import { Contact } from './pages/public/Contact';
import { Vault } from './pages/customer/Vault';
import { Compare } from './pages/customer/Compare';
import { ClaimSim } from './pages/customer/ClaimSim';
import { Dashboard as BrokerDashboard } from './pages/broker/Dashboard';
import { Claims as BrokerClaims } from './pages/broker/Claims';
import { Leads as BrokerLeads } from './pages/broker/Leads';
import { AIAssistant as BrokerAIAssistant } from './pages/broker/AIAssistant';
import { Reports as BrokerReports } from './pages/broker/Reports';
import { Analytics as BrokerAnalytics } from './pages/broker/Analytics';
import { Documents as BrokerDocuments } from './pages/broker/Documents';
import { Team as BrokerTeam } from './pages/broker/Team';
import { Settings as BrokerSettings } from './pages/broker/Settings';
import { Clients as BrokerClients } from './pages/broker/Clients';
import { Policies as BrokerPolicies } from './pages/broker/Policies';
import { Renewals as BrokerRenewals } from './pages/broker/Renewals';
import { Premiums as BrokerPremiums } from './pages/broker/Premiums';
import { Commission as BrokerCommission } from './pages/broker/Commission';

/**
 * Top-level route table for the PolicyLens SPA (design: Routing & Role-Based
 * Access).
 *
 * Three route groups, each wrapped in its own themed layout:
 * - Public pages under {@link PublicLayout} (customer dark chrome, no guard).
 * - `/app/*` customer portal under {@link CustomerLayout}, guarded by
 *   `RoleRoute allow={['customer']}` (R17.2, R17.5).
 * - `/broker/*` broker portal under {@link BrokerLayout}, guarded by
 *   `RoleRoute allow={['broker']}`.
 *
 * Leaf pages are placeholders until tasks 11.x (customer) and 12.x (broker)
 * deliver the real screens.
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes (R20, R17.3) */}
        <Route element={<PublicLayout />}>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/try" element={<Try />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/not-authorized" element={<NotAuthorized />} />
        </Route>

        {/* Customer portal — role: customer (R17.2, R17.5) */}
        <Route
          path="/app"
          element={
            <RoleRoute allow={['customer']}>
              <CustomerLayout />
            </RoleRoute>
          }
        >
          <Route index element={<Vault />} />
          <Route path="upload" element={<Upload />} />
          <Route path="policy/:id" element={<PolicyDashboard />} />
          <Route path="policy/:id/chat" element={<PolicyChat />} />
          <Route path="vault" element={<Vault />} />
          <Route path="compare" element={<Compare />} />
          <Route path="claim-sim" element={<ClaimSim />} />
          <Route path="upgrade" element={<Upgrade />} />
        </Route>

        {/* Broker portal — role: broker (R17.2, R17.5) */}
        <Route
          path="/broker"
          element={
            <RoleRoute allow={['broker']}>
              <BrokerLayout />
            </RoleRoute>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<BrokerDashboard />} />
          <Route path="clients" element={<BrokerClients />} />
          <Route path="policies" element={<BrokerPolicies />} />
          <Route path="renewals" element={<BrokerRenewals />} />
          <Route path="premiums" element={<BrokerPremiums />} />
          <Route path="commission" element={<BrokerCommission />} />
          <Route path="claims" element={<BrokerClaims />} />
          <Route path="leads" element={<BrokerLeads />} />
          <Route path="ai-assistant" element={<BrokerAIAssistant />} />
          <Route path="reports" element={<BrokerReports />} />
          <Route path="analytics" element={<BrokerAnalytics />} />
          <Route path="documents" element={<BrokerDocuments />} />
          <Route path="team" element={<BrokerTeam />} />
          <Route path="settings" element={<BrokerSettings />} />
        </Route>

        {/* Unknown paths → landing */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
