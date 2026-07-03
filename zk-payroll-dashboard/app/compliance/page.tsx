import DashboardLayout from "@/components/layout/DashboardLayout";
import ComplianceManager from "@/components/features/compliance/ComplianceManager";

function CompliancePage() {
  return (
    <DashboardLayout>
      <ComplianceManager />
    </DashboardLayout>
  );
}

export default CompliancePage;
