"""
Snake Game Clone in Python
A classic Snake game implementation using Pygame
"""

import pygame
import random
import sys

class Snake:
    def __init__(self):
        self.positions = [(10, 10)]  # Starting position
        self.direction = (1, 0)      # Moving right initially
        self.grow = False
        self.color = (0, 255, 0)     # Green color
    
    def get_head_position(self):
        return self.positions[0]
    
    def update(self):
        head = self.get_head_position()
        x, y = self.direction
        new_x = (head[0] + x) % 20  # Wrap around screen
        new_y = (head[1] + y) % 20  # Wrap around screen
        new_position = (new_x, new_y)
        
        if self.grow:
            self.positions = [new_position] + self.positions
            self.grow = False
        else:
            self.positions = [new_position] + self.positions[:-1]
    
    def change_direction(self, new_direction):
        # Prevent 180-degree turns
        if (new_direction[0] * -1, new_direction[1] * -1) != self.direction:
            self.direction = new_direction
    
    def check_collision(self):
        head = self.get_head_position()
        return head in self.positions[1:]
    
    def draw(self, surface):
        for p in self.positions:
            rect = pygame.Rect((p[0] * 20, p[1] * 20), (20, 20))
            pygame.draw.rect(surface, self.color, rect)
            pygame.draw.rect(surface, (0, 150, 0), rect, 1)

class Food:
    def __init__(self):
        self.position = (0, 0)
        self.color = (255, 0, 0)  # Red color
        self.randomize_position()
    
    def randomize_position(self):
        self.position = (random.randint(0, 19), random.randint(0, 19))
    
    def draw(self, surface):
        rect = pygame.Rect((self.position[0] * 20, self.position[1] * 20), (20, 20))
        pygame.draw.rect(surface, self.color, rect)
        pygame.draw.rect(surface, (150, 0, 0), rect, 1)

def main():
    pygame.init()
    
    # Constants
    GRID_SIZE = 20
    GRID_WIDTH = 20
    GRID_HEIGHT = 20
    SCREEN_SIZE = (GRID_WIDTH * GRID_SIZE, GRID_HEIGHT * GRID_SIZE)
    FPS = 10
    
    # Setup display
    screen = pygame.display.set_mode(SCREEN_SIZE)
    pygame.display.set_caption('PyC-Snake')
    clock = pygame.time.Clock()
    
    # Create game objects
    snake = Snake()
    food = Food()
    
    # Font setup
    font = pygame.font.SysFont('Arial', 20)
    
    # Game state
    score = 0
    game_over = False
    
    while True:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit()
                sys.exit()
            elif event.type == pygame.KEYDOWN:
                if game_over and event.key == pygame.K_r:
                    # Restart game
                    snake = Snake()
                    food.randomize_position()
                    score = 0
                    game_over = False
                elif not game_over:
                    if event.key == pygame.K_UP:
                        snake.change_direction((0, -1))
                    elif event.key == pygame.K_DOWN:
                        snake.change_direction((0, 1))
                    elif event.key == pygame.K_LEFT:
                        snake.change_direction((-1, 0))
                    elif event.key == pygame.K_RIGHT:
                        snake.change_direction((1, 0))
        
        if not game_over:
            snake.update()
            
            # Check for collision with food
            if snake.get_head_position() == food.position:
                score += 1
                snake.grow = True
                food.randomize_position()
                
            # Check for collision with self
            if snake.check_collision():
                game_over = True
        
        # Draw everything
        screen.fill((0, 0, 0))
        snake.draw(screen)
        food.draw(screen)
        
        # Draw score
        score_text = font.render(f'Score: {score}', True, (255, 255, 255))
        screen.blit(score_text, (10, 10))
        
        # Draw game over message
        if game_over:
            game_over_text = font.render('Game Over! Press R to restart', True, (255, 0, 0))
            screen.blit(game_over_text, (SCREEN_SIZE[0]//2 - 100, SCREEN_SIZE[1]//2))
        
        pygame.display.update()
        clock.tick(FPS)

if __name__ == '__main__':
    main()
