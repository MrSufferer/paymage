import CompanySetup from "@/components/features/company/CompanySetup";

function SetupPage() {
  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
      <div className="bg-white rounded-lg shadow-sm p-8 w-full max-w-md">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">Company Setup</h1>
          <p className="text-sm text-gray-500 mt-1">
            Configure your company before managing payroll.
          </p>
        </div>
        <CompanySetup />
      </div>
    </main>
  );
}

export default SetupPage;
