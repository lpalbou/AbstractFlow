"""
Explosion animation sprite for R-Type inspired game.
Minimalist design using Pygame shapes and frame-based animation.
"""

import pygame

class Explosion:
    def __init__(self, x, y):
        self.x = x
        self.y = y
        self.frames = []
        # Create 6 frames of explosion (growing circles)
        for i in range(1, 7):
            radius = i * 4
            self.frames.append(radius)
        self.current_frame = 0
        self.active = True

    def update(self):
        if self.current_frame < len(self.frames) - 1:
            self.current_frame += 1
        else:
            self.active = False

    def draw(self, surface):
        if self.active:
            radius = self.frames[self.current_frame]
            # Draw expanding circle with fading color
            alpha = 255 - (self.current_frame * 40)
            color = (255, 150, 50, alpha)  # Orange-red with fade
            pygame.draw.circle(surface, color, (int(self.x), int(self.y)), radius)

            # Add radial lines for energy effect
            if self.current_frame > 2:
                for angle in range(0, 360, 45):
                    rad = pygame.math.Vector2(1).rotate(angle)
                    end_x = self.x + rad.x * radius
                    end_y = self.y + rad.y * radius
                    pygame.draw.line(surface, (255, 200, 100), (self.x, self.y), (end_x, end_y), 1)
