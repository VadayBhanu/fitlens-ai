import { lazy, Suspense, type ReactElement } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { useAuth } from "./lib/auth";
import { Home } from "./pages/Home";
import { Login, Signup } from "./pages/Auth";
import { NotFound } from "./pages/NotFound";
import { Privacy, Terms } from "./pages/Legal";

const Studio = lazy(() => import("./pages/Studio"));
const Mirror = lazy(() => import("./pages/Mirror"));
const Deals = lazy(() => import("./pages/Deals"));
const Wardrobe = lazy(() => import("./pages/Wardrobe"));
const Account = lazy(() => import("./pages/Account"));

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <PageSpinner />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return children;
}

function PageSpinner() {
  return (
    <div className="container row" style={{ justifyContent: "center", padding: 80 }}>
      <Spinner label="Loading" />
    </div>
  );
}

export function App() {
  return (
    <Layout>
      <ErrorBoundary>
        <Suspense fallback={<PageSpinner />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/studio" element={<RequireAuth><Studio /></RequireAuth>} />
            <Route path="/mirror" element={<Mirror />} />
            <Route path="/deals/:productId" element={<RequireAuth><Deals /></RequireAuth>} />
            <Route path="/wardrobe" element={<RequireAuth><Wardrobe /></RequireAuth>} />
            <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </Layout>
  );
}
