import DashboardLayout from "@/components/layout/DashboardLayout";
import SetEmployeeRoot from "@/components/features/employees/SetEmployeeRoot";
import InfrastructureRoadmap from "@/components/features/infrastructure/InfrastructureRoadmap";

function InfrastructurePage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <SetEmployeeRoot />
        <InfrastructureRoadmap />
      </div>
    </DashboardLayout>
  );
}

export default InfrastructurePage;
