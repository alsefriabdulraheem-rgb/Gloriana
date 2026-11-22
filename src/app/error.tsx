"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="font-display text-3xl font-semibold text-plum-700">TREMLY</div>
      <p>حدث خطأ غير متوقع · Something went wrong</p>
      <button onClick={reset} className="btn-primary">↻</button>
    </div>
  );
}
