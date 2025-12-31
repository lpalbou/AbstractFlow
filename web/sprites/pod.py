"""
Detachable Pod sprite for R-Type inspired game.
Minimalist design using Pygame shapes with positioning logic.
"""

import pygame

class Pod:
    def __init__(self, x, y):
        self.width = 18
        self.height = 10
        self.x = x
        self.y = y
        self.speed = 3
        self.active = True
        self.follow_distance = 40  # Distance to follow player
        self.offset_x = 0
        self.offset_y = 0

    def update(self, player_x, player_y):
        if not self.active:
            return
        
        # Follow the player with a slight delay (smoother trailing)
        self.offset_x = (player_x - self.x) * 0.1
        self.offset_y = (player_y - self.y) * 0.1
        
        self.x += self.offset_x
        self.y += self.offset_y

    def draw(self, surface):
        if not self.active:
            return
        
        # Main body: small rectangle
        pygame.draw.rect(surface, (100, 200, 255), (self.x, self.y, self.width, self.height))
        
        # Connector line to player (optional visual)
        pygame.draw.line(surface, (150, 255, 255), (self.x + self.width//2, self.y + self.height//2), 
                         (self.x + self.width//2 - 10, self.y + self.height//2), 2)
        
        # Antenna
        pygame.draw.line(surface, (255, 255, 100), 
                         (self.x + self.width//2, self.y - 3), 
                         (self.x + self.width//2, self.y - 8), 1)
