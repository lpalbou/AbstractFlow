/**
 * SVG shapes for pin types (Blueprint-inspired).
 */

import type { PinType } from '../../types/flow';

interface PinShapeProps {
  type: PinType;
  size?: number;
  filled?: boolean;
}

export function PinShape({ type, size = 12, filled = false }: PinShapeProps) {
  const half = size / 2;

  switch (type) {
    case 'execution':
      // Triangle (right-pointing arrow)
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <polygon
            points={`0,0 ${size},${half} 0,${size}`}
            fill={filled ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      );

    case 'boolean':
      // Diamond
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <polygon
            points={`${half},0 ${size},${half} ${half},${size} 0,${half}`}
            fill={filled ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      );

    case 'array':
    case 'tools':
      // Square
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <rect
            x="1"
            y="1"
            width={size - 2}
            height={size - 2}
            fill={filled ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      );

    case 'agent':
      // Hexagon
      const hexPoints = [
        [half, 0],
        [size, size * 0.25],
        [size, size * 0.75],
        [half, size],
        [0, size * 0.75],
        [0, size * 0.25],
      ]
        .map(([x, y]) => `${x},${y}`)
        .join(' ');
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <polygon
            points={hexPoints}
            fill={filled ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      );

    default:
      // Circle (default for string, number, object, any)
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={half}
            cy={half}
            r={half - 1}
            fill={filled ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      );
  }
}

export default PinShape;
