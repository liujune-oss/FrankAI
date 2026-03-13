"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";

interface BackButtonProps {
    /** Custom back handler. Defaults to router.back() */
    onClick?: () => void;
    /** Additional CSS classes */
    className?: string;
    /** Icon size */
    size?: number;
}

/**
 * Animated back button with tap feedback and smooth transitions.
 * Uses framer-motion for fluid animations.
 */
export default function BackButton({ onClick, className = "", size = 20 }: BackButtonProps) {
    const router = useRouter();

    const handleClick = () => {
        if (onClick) {
            onClick();
        } else {
            router.back();
        }
    };

    return (
        <motion.button
            onClick={handleClick}
            className={`p-1.5 rounded-lg hover:bg-muted transition-colors flex-shrink-0 relative overflow-hidden ${className}`}
            whileTap={{ scale: 0.85 }}
            transition={{
                type: "spring",
                stiffness: 400,
                damping: 17
            }}
        >
            {/* Ripple effect on tap */}
            <motion.div
                className="absolute inset-0 bg-white/20 rounded-lg"
                initial={{ scale: 0, opacity: 0 }}
                whileTap={{ scale: 2, opacity: 1 }}
                transition={{ duration: 0.3 }}
            />
            <motion.div
                whileHover={{ x: -2 }}
                transition={{
                    type: "spring",
                    stiffness: 400,
                    damping: 17
                }}
            >
                <ArrowLeft size={size} />
            </motion.div>
        </motion.button>
    );
}