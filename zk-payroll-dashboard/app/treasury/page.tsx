import DashboardLayout from "@/components/layout/DashboardLayout";
import SetEmployeeRoot from "@/components/features/employees/SetEmployeeRoot";
import TreasuryView from "@/components/features/treasury/TreasuryView";

function TreasuryPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <SetEmployeeRoot />
        <TreasuryView />
      </div>
    </DashboardLayout>
  );
}

export default TreasuryPage;
