import DashboardLayout from "@/components/layout/DashboardLayout";
import PayrollWizard from "@/components/features/payroll/PayrollWizard";

function PayrollExecutePage() {
  return (
    <DashboardLayout>
      <PayrollWizard />
    </DashboardLayout>
  );
}

export default PayrollExecutePage;
