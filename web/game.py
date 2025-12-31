"""
R-Type Inspired Game - Core Game Loop
Implements horizontal scrolling background with parallax layers and sprite integration.
"""

import pygame
import random
import sys

# Initialize Pygame
pygame.init()

# Constants
SCREEN_WIDTH = 1024
SCREEN_HEIGHT = 768
FPS = 60
BACKGROUND_SPEED_FAR = 0.5   # Slowest layer (far background)
BACKGROUND_SPEED_MID = 1.5     # Medium speed (midground)
BACKGROUND_SPEED_NEAR = 3.0    # Fastest layer (foreground)

# Colors
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
BLUE = (0, 128, 255)
RED = (255, 0, 0)
GREEN = (0, 255, 128)

# Set up display
screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
pygame.display.set_caption("R-Type Inspired")
clock = pygame.time.Clock()

# --- PARALLAX BACKGROUND LAYERS ---
class ParallaxLayer:
    def __init__(self, speed, color, element_count):
        self.speed = speed
        self.color = color
        self.elements = []
        for _ in range(element_count):
            x = random.randint(0, SCREEN_WIDTH)
            y = random.randint(0, SCREEN_HEIGHT)
            size = random.randint(1, 4)
            self.elements.append([x, y, size])

    def update(self):
        for element in self.elements:
            element[0] -= self.speed  # Move left
            if element[0] < -10:  # Reset when off-screen
                element[0] = SCREEN_WIDTH + random.randint(0, 100)
                element[1] = random.randint(0, SCREEN_HEIGHT)

    def draw(self, surface):
        for element in self.elements:
            pygame.draw.circle(surface, self.color, (int(element[0]), int(element[1])), element[2])

# Create parallax layers (far, mid, near)
far_layer = ParallaxLayer(BACKGROUND_SPEED_FAR, (30, 30, 70), 150)   # Dark blue stars
mid_layer = ParallaxLayer(BACKGROUND_SPEED_MID, (50, 100, 200), 80)  # Lighter blue stars
near_layer = ParallaxLayer(BACKGROUND_SPEED_NEAR, (100, 200, 255), 40) # Bright stars

# --- SPRITE CLASSES (placeholder imports from Task 1) ---
# We'll create minimal placeholder classes since the actual sprite files are referenced but not yet created

class Player:
    def __init__(self):
        self.x = SCREEN_WIDTH // 4
        self.y = SCREEN_HEIGHT // 2
        self.width = 30
        self.height = 15
        self.speed = 5

    def update(self):
        keys = pygame.key.get_pressed()
        if keys[pygame.K_UP] and self.y > 0:
            self.y -= self.speed
        if keys[pygame.K_DOWN] and self.y < SCREEN_HEIGHT - self.height:
            self.y += self.speed
        if keys[pygame.K_LEFT] and self.x > 0:
            self.x -= self.speed
        if keys[pygame.K_RIGHT] and self.x < SCREEN_WIDTH - self.width:
            self.x += self.speed

    def draw(self, surface):
        pygame.draw.rect(surface, BLUE, (self.x, self.y, self.width, self.height))
        # Draw a simple "antenna" for R-type feel
        pygame.draw.line(surface, WHITE, (self.x + self.width//2, self.y - 5), (self.x + self.width//2, self.y), 2)

class Enemy:
    def __init__(self):
        self.x = SCREEN_WIDTH + random.randint(50, 200)
        self.y = random.randint(50, SCREEN_HEIGHT - 50)
        self.width = 25
        self.height = 15
        self.speed = 2

    def update(self):
        self.x -= self.speed
        if self.x < -self.width:
            self.x = SCREEN_WIDTH + random.randint(50, 200)
            self.y = random.randint(50, SCREEN_HEIGHT - 50)

    def draw(self, surface):
        pygame.draw.rect(surface, RED, (self.x, self.y, self.width, self.height))

# --- MAIN GAME LOOP ---
def main():
    player = Player()
    enemies = [Enemy() for _ in range(5)]

    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False

        # Update background layers
        far_layer.update()
        mid_layer.update()
        near_layer.update()

        # Update sprites
        player.update()
        for enemy in enemies:
            enemy.update()

        # Draw everything
        screen.fill(BLACK)

        # Draw parallax layers (back to front)
        far_layer.draw(screen)
        mid_layer.draw(screen)
        near_layer.draw(screen)

        # Draw sprites (on top of background)
        player.draw(screen)
        for enemy in enemies:
            enemy.draw(screen)

        # Update display
        pygame.display.flip()
        clock.tick(FPS)

    pygame.quit()
    sys.exit()

if __name__ == "__main__":
    main()
