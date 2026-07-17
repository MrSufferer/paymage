import DashboardLayout from "@/components/layout/DashboardLayout";
import SetEmployeeRoot from "@/components/features/employees/SetEmployeeRoot";
import PayrollWizard from "@/components/features/payroll/PayrollWizard";

function PayrollExecutePage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <SetEmployeeRoot />
        <PayrollWizard />
      </div>
    </DashboardLayout>
  );
}

export default PayrollExecutePage;
