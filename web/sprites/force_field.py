"""
Force Field visual and behavior for R-Type inspired game.
Minimalist design using Pygame shapes and ring animation.
"""

import pygame

class ForceField:
    def __init__(self, x, y):
        self.x = x
        self.y = y
        self.radius = 20
        self.max_radius = 80
        self.growth_rate = 1.2
        self.shrink_rate = 0.8
        self.active = False
        self.color = (0, 200, 255)
        self.alpha = 180

    def activate(self):
        self.active = True

    def deactivate(self):
        self.active = False

    def update(self):
        if not self.active:
            return
        
        # Expand outward
        if self.radius < self.max_radius:
            self.radius *= self.growth_rate
        else:
            # Start shrinking if fully expanded
            self.radius *= self.shrink_rate
            if self.radius < 20:
                self.radius = 20

    def draw(self, surface):
        if not self.active:
            return
        
        # Draw concentric rings with fading alpha
        for i in range(3):
            ring_radius = self.radius - (i * 8)
            if ring_radius > 0:
                alpha = self.alpha - (i * 60)
                if alpha < 0:
                    alpha = 0
                color_with_alpha = (*self.color, alpha)
                # Pygame doesn't support alpha in draw.circle directly, so we use a surface
                ring_surface = pygame.Surface((ring_radius * 2, ring_radius * 2), pygame.SRCALPHA)
                pygame.draw.circle(ring_surface, color_with_alpha, (ring_radius, ring_radius), ring_radius, 2)
                surface.blit(ring_surface, (self.x - ring_radius, self.y - ring_radius))

        # Inner glow
        pygame.draw.circle(surface, (100, 255, 255), (int(self.x), int(self.y)), 4)
