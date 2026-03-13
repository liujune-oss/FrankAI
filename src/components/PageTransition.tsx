"use client";

import { motion, AnimatePresence, Transition } from "framer-motion";
import { ReactNode } from "react";

interface PageTransitionProps {
    children: ReactNode;
    /** Unique key for each page to trigger animation */
    pageKey?: string;
}

const pageVariants = {
    initial: {
        opacity: 0,
        x: -20,
    },
    in: {
        opacity: 1,
        x: 0,
    },
    out: {
        opacity: 0,
        x: 20,
    },
};

const pageTransition: Transition = {
    type: "tween",
    ease: "anticipate",
    duration: 0.25,
};

/**
 * Wrapper component that adds smooth page transition animations.
 * Wrap page content with this component to enable transitions.
 */
export default function PageTransition({ children, pageKey }: PageTransitionProps) {
    return (
        <AnimatePresence mode="wait">
            <motion.div
                key={pageKey}
                initial="initial"
                animate="in"
                exit="out"
                variants={pageVariants}
                transition={pageTransition}
                className="h-full w-full"
            >
                {children}
            </motion.div>
        </AnimatePresence>
    );
}

/**
 * Animation variants for staggered children animations.
 * Use with motion elements inside pages for orchestrated entrance.
 */
export const staggerContainer = {
    initial: {},
    animate: {
        transition: {
            staggerChildren: 0.05,
        },
    },
};

export const staggerItem = {
    initial: { opacity: 0, y: 10 },
    animate: {
        opacity: 1,
        y: 0,
        transition: {
            type: "spring",
            stiffness: 300,
            damping: 24,
        },
    },
};