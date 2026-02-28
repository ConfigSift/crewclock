export default function ReportsErrorState({ message }: { message: string }) {
  return (
    <div className="animate-fade-in">
      <h1 className="mb-4 text-[22px] font-extrabold tracking-tight">Reports</h1>
      <div className="rounded-2xl border border-red-border bg-red-dark p-5">
        <p className="text-sm font-semibold text-red">{message}</p>
      </div>
    </div>
  );
}
