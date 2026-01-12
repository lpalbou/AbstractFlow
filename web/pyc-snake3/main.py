"""
Snake Game Clone
A Python implementation of the classic Snake game using Pygame
"""

import pygame
import random
import sys
from typing import List, Tuple

class Snake:
    def __init__(self):
        self.body = [(10, 10)]  # Starting position
        self.direction = (0, -1)  # Start moving up
        self.grow_pending = False
        
    def move(self):
        head_x, head_y = self.body[0]
        dir_x, dir_y = self.direction
        new_head = (head_x + dir_x, head_y + dir_y)
        
        # Check if snake hits itself
        if new_head in self.body:
            return False  # Game over
        
        # Add new head
        self.body.insert(0, new_head)
        
        # If not growing, remove tail
        if not self.grow_pending:
            self.body.pop()
        else:
            self.grow_pending = False
        
        return True  # Game continues
    
    def change_direction(self, new_direction):
        # Prevent 180-degree turns
        if (new_direction[0] * -1, new_direction[1] * -1) != self.direction:
            self.direction = new_direction
    
    def grow(self):
        self.grow_pending = True
    
    def get_head(self):
        return self.body[0]
    
    def get_body(self):
        return self.body

class Food:
    def __init__(self, grid_width: int, grid_height: int):
        self.grid_width = grid_width
        self.grid_height = grid_height
        self.position = (random.randint(0, grid_width - 1), random.randint(0, grid_height - 1))
    
    def generate_new_position(self, snake_body: List[Tuple[int, int]]):
        # Generate new position not on the snake
        while True:
            self.position = (random.randint(0, self.grid_width - 1), random.randint(0, self.grid_height - 1))
            if self.position not in snake_body:
                break
    
    def get_position(self):
        return self.position

class Game:
    def __init__(self):
        # Constants
        self.GRID_SIZE = 20
        self.GRID_WIDTH = 30
        self.GRID_HEIGHT = 20
        self.WINDOW_WIDTH = self.GRID_SIZE * self.GRID_WIDTH
        self.WINDOW_HEIGHT = self.GRID_SIZE * self.GRID_HEIGHT
        self.FPS = 10
        
        # Game state
        self.snake = Snake()
        self.food = Food(self.GRID_WIDTH, self.GRID_HEIGHT)
        self.score = 0
        self.game_over = False
        
        # Initialize pygame
        pygame.init()
        self.screen = pygame.display.set_mode((self.WINDOW_WIDTH, self.WINDOW_HEIGHT))
        pygame.display.set_caption('Snake Game')
        self.clock = pygame.time.Clock()
        
        # Colors
        self.BLACK = (0, 0, 0)
        self.WHITE = (255, 255, 255)
        self.GREEN = (0, 255, 0)
        self.RED = (255, 0, 0)
        self.GRAY = (100, 100, 100)
    
    def handle_events(self):
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return False
            elif event.type == pygame.KEYDOWN:
                if self.game_over:
                    if event.key == pygame.K_r:
                        self.reset_game()
                else:
                    if event.key == pygame.K_UP or event.key == pygame.K_w:
                        self.snake.change_direction((0, -1))
                    elif event.key == pygame.K_DOWN or event.key == pygame.K_s:
                        self.snake.change_direction((0, 1))
                    elif event.key == pygame.K_LEFT or event.key == pygame.K_a:
                        self.snake.change_direction((-1, 0))
                    elif event.key == pygame.K_RIGHT or event.key == pygame.K_d:
                        self.snake.change_direction((1, 0))
        return True
    
    def update(self):
        if self.game_over:
            return
        
        # Move snake
        if not self.snake.move():
            self.game_over = True
            return
        
        # Check if snake eats food
        head_pos = self.snake.get_head()
        if head_pos == self.food.get_position():
            self.snake.grow()
            self.food.generate_new_position(self.snake.get_body())
            self.score += 1
        
        # Check if snake hits wall (optional: make this configurable)
        head_x, head_y = head_pos
        if head_x < 0 or head_x >= self.GRID_WIDTH or head_y < 0 or head_y >= self.GRID_HEIGHT:
            self.game_over = True
    
    def draw(self):
        # Clear screen
        self.screen.fill(self.BLACK)
        
        # Draw grid (optional, for visual appeal)
        for x in range(0, self.WINDOW_WIDTH, self.GRID_SIZE):
            pygame.draw.line(self.screen, self.GRAY, (x, 0), (x, self.WINDOW_HEIGHT))
        for y in range(0, self.WINDOW_HEIGHT, self.GRID_SIZE):
            pygame.draw.line(self.screen, self.GRAY, (0, y), (self.WINDOW_WIDTH, y))
        
        # Draw snake
        for i, segment in enumerate(self.snake.get_body()):
            color = self.GREEN if i == 0 else (50, 200, 50)  # Head is brighter
            rect = pygame.Rect(segment[0] * self.GRID_SIZE, segment[1] * self.GRID_SIZE, 
                             self.GRID_SIZE - 1, self.GRID_SIZE - 1)
            pygame.draw.rect(self.screen, color, rect)
        
        # Draw food
        food_pos = self.food.get_position()
        rect = pygame.Rect(food_pos[0] * self.GRID_SIZE, food_pos[1] * self.GRID_SIZE, 
                         self.GRID_SIZE - 1, self.GRID_SIZE - 1)
        pygame.draw.rect(self.screen, self.RED, rect)
        
        # Draw score
        font = pygame.font.SysFont('Arial', 24)
        score_text = font.render(f'Score: {self.score}', True, self.WHITE)
        self.screen.blit(score_text, (10, 10))
        
        # Draw game over message
        if self.game_over:
            font = pygame.font.SysFont('Arial', 48)
            game_over_text = font.render('GAME OVER', True, self.RED)
            restart_text = pygame.font.SysFont('Arial', 24).render('Press R to Restart', True, self.WHITE)
            
            game_over_rect = game_over_text.get_rect(center=(self.WINDOW_WIDTH // 2, self.WINDOW_HEIGHT // 2 - 30))
            restart_rect = restart_text.get_rect(center=(self.WINDOW_WIDTH // 2, self.WINDOW_HEIGHT // 2 + 30))
            
            self.screen.blit(game_over_text, game_over_rect)
            self.screen.blit(restart_text, restart_rect)
        
        pygame.display.flip()
    
    def reset_game(self):
        self.snake = Snake()
        self.food = Food(self.GRID_WIDTH, self.GRID_HEIGHT)
        self.score = 0
        self.game_over = False
    
    def run(self):
        while True:
            if not self.handle_events():
                break
            
            self.update()
            self.draw()
            self.clock.tick(self.FPS)
        
        pygame.quit()
        sys.exit()

if __name__ == '__main__':
    game = Game()
    game.run()