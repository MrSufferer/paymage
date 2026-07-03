import DashboardLayout from "@/components/layout/DashboardLayout";
import EmployeeDirectory from "@/components/features/employees/EmployeeDirectory";
import SetEmployeeRoot from "@/components/features/employees/SetEmployeeRoot";

function EmployeesPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <SetEmployeeRoot />
        <EmployeeDirectory />
      </div>
    </DashboardLayout>
  );
}

export default EmployeesPage;
