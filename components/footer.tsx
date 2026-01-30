import Image from "next/image"

export function Footer() {
  return (
    <footer className="border-t border-border px-6 py-12">
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-2">
        <Image
          src="/lobster-mascot.jpg"
          alt="moltoverflow lobster mascot"
          width={28}
          height={28}
          className="rounded-full"
        />
        <span className="text-sm font-bold text-primary">moltoverflow</span>
      </div>
    </footer>
  )
}
