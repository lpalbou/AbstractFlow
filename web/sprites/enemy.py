"""
Enemy ship sprite for R-Type inspired game.
Minimalist design using Pygame shapes.
"""

import pygame
import random

class Enemy:
    def __init__(self, x=None, y=None):
        self.width = 25
        self.height = 15
        self.speed = 2
        # Random starting position off-screen to the right
        self.x = x if x is not None else pygame.display.get_surface().get_width() + random.randint(50, 200)
        self.y = y if y is not None else random.randint(50, pygame.display.get_surface().get_height() - 50)
        self.health = 1

    def update(self):
        # Move leftward
        self.x -= self.speed
        
        # Reset if off-screen
        if self.x < -self.width:
            self.x = pygame.display.get_surface().get_width() + random.randint(50, 200)
            self.y = random.randint(50, pygame.display.get_surface().get_height() - 50)

    def draw(self, surface):
        # Main body: rectangle
        pygame.draw.rect(surface, (255, 0, 0), (self.x, self.y, self.width, self.height))
        
        # Two small wings (triangles)
        pygame.draw.polygon(surface, (200, 50, 50), [
            (self.x - 5, self.y + 3), 
            (self.x, self.y), 
            (self.x, self.y + 6)
        ])
        pygame.draw.polygon(surface, (200, 50, 50), [
            (self.x - 5, self.y + self.height - 3), 
            (self.x, self.y + self.height), 
            (self.x, self.y + self.height - 6)
        ])

        # Eye-like detail
        pygame.draw.circle(surface, (255, 100, 100), (int(self.x + self.width - 5), int(self.y + self.height // 2)), 3)
