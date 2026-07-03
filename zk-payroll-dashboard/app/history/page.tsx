import DashboardLayout from "@/components/layout/DashboardLayout";
import TransactionHistory from "@/components/features/transactions/TransactionHistory";

function HistoryPage() {
  return (
    <DashboardLayout>
      <TransactionHistory />
    </DashboardLayout>
  );
}

export default HistoryPage;
