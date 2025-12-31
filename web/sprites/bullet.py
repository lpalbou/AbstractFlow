"""
Bullet projectile sprite for R-Type inspired game.
Minimalist design using Pygame shapes.
"""

import pygame

class Bullet:
    def __init__(self, x, y, speed=8):
        self.width = 6
        self.height = 2
        self.x = x
        self.y = y
        self.speed = speed
        self.active = True

    def update(self):
        self.x += self.speed  # Move rightward (player fires forward)
        if self.x > pygame.display.get_surface().get_width():
            self.active = False

    def draw(self, surface):
        if self.active:
            pygame.draw.rect(surface, (255, 255, 100), (self.x, self.y, self.width, self.height))
            # Add a small glow effect with a line
            pygame.draw.line(surface, (255, 255, 200), (self.x + self.width, self.y + self.height // 2), (self.x + self.width + 5, self.y + self.height // 2), 1)
