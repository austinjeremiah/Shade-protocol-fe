"use client"

import { useRef, useState } from "react"
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion"
import { SentientSphere } from "./sentient-sphere"

export function Hero() {
  const containerRef = useRef<HTMLElement>(null)
  const [isFlipped, setIsFlipped] = useState(false)
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end start"],
  })

  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0])
  const scale = useTransform(scrollYProgress, [0, 0.5], [1, 0.8])

  return (
    <section ref={containerRef} className="relative h-screen w-full overflow-hidden">
      {/* Split background — animates on hover */}
      <div className="absolute inset-0 flex">
        <motion.div
          className="h-full"
          style={{ background: "#F5F2EC" }}
          animate={{ width: isFlipped ? "0%" : "50%" }}
          transition={{ duration: 0.8, ease: [0.76, 0, 0.24, 1] }}
        />
        <motion.div
          className="h-full"
          style={{ background: "#050505", borderLeft: "1px solid rgba(237,234,227,0.18)" }}
          animate={{ width: isFlipped ? "100%" : "50%" }}
          transition={{ duration: 0.8, ease: [0.76, 0, 0.24, 1] }}
        />
      </div>

      {/* 3D Sphere */}
      <div className="absolute inset-0">
        <SentientSphere />
      </div>

      {/* Typography Overlay */}
      <motion.div style={{ opacity, scale }} className="relative z-10 h-full flex flex-col justify-between p-8 md:p-12 md:px-12 md:py-20">
        {/* Top Left - SHADE */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <motion.h2
            className="font-sans text-5xl md:text-7xl lg:text-8xl font-light tracking-tight"
            animate={{ color: isFlipped ? "#EDEAE3" : "#1A1820" }}
            transition={{ duration: 0.6, ease: [0.76, 0, 0.24, 1] }}
          >
            SHADE
            <br />
            <span className="italic text-3xl md:text-5xl lg:text-6xl" style={{ marginTop: "-0.15em", display: "block" }}>PROTOCOL</span>
          </motion.h2>
        </motion.div>

        {/* Center Button */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20"
        >
          <motion.button
            data-cursor-hover
            onHoverStart={() => setIsFlipped(true)}
            onHoverEnd={() => setIsFlipped(false)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="relative px-8 py-4 rounded-full font-mono text-sm tracking-widest uppercase text-white backdrop-blur-md transition-colors duration-500"
            style={{ background: "rgba(10,10,12,0.55)", border: "1px solid rgba(237,234,227,0.25)" }}
          >
            Initialize
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-[#2563eb] rounded-full animate-pulse" />
          </motion.button>
        </motion.div>

        {/* Bottom Right */}
        <motion.div
          initial={{ opacity: 0, y: -40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="self-end text-right"
        >
          <p className="font-mono text-xs tracking-[0.3em] text-muted-foreground mb-2">ZK CROSS-CHAIN PROTOCOL</p>
          <h2 className="font-sans text-4xl md:text-6xl lg:text-7xl font-light tracking-tight text-balance">
            PRIVATE
            <br />
            <span className="italic">SETTLEMENT</span>
          </h2>
        </motion.div>
      </motion.div>

      {/* Left bottom text */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8, duration: 1 }}
        className="absolute z-20"
        style={{ bottom: "12%", left: "3.5%" }}
      >
        <motion.p
          className="font-sans text-base md:text-lg leading-relaxed max-w-[320px]"
          animate={{ color: isFlipped ? "rgba(237,234,227,0.55)" : "#4A4454" }}
          transition={{ duration: 0.6 }}
        >
          Move USDC privately across chains.<br />Shield it, settle with proof.
        </motion.p>
      </motion.div>

      {/* Right top text */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.9, duration: 1 }}
        className="absolute z-20"
        style={{ top: "12%", right: "3.5%", textAlign: "left" }}
      >
        <p className="font-sans text-base md:text-lg leading-relaxed max-w-[320px]" style={{ color: "rgba(237,234,227,0.55)" }}>
          Your keys. Your note. Your proof.<br />Nothing leaves your device.
        </p>
      </motion.div>

      {/* Scroll Indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10"
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
          className="flex flex-col items-center gap-2"
        >
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">Scroll</span>
          <div className="w-px h-8 bg-gradient-to-b from-white/50 to-transparent" />
        </motion.div>
      </motion.div>
    </section>
  )
}
