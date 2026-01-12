"""
Snake Game Clone in Python
A simple terminal-based Snake game with arrow key controls.
"""

import random
import os
import time
import sys
from collections import deque

class SnakeGame:
    def __init__(self, width=20, height=15):
        self.width = width
        self.height = height
        # Initialize snake in the middle of the screen
        self.snake = deque([(width // 2, height // 2)])
        # Random initial direction
        self.direction = random.choice(['UP', 'DOWN', 'LEFT', 'RIGHT'])
        self.food = self.generate_food()
        self.score = 0
        self.game_over = False
        
    def generate_food(self):
        while True:
            x = random.randint(0, self.width - 1)
            y = random.randint(0, self.height - 1)
            if (x, y) not in self.snake:
                return (x, y)
    
    def move_snake(self):
        head_x, head_y = self.snake[0]
        
        # Calculate new head position based on direction
        if self.direction == 'UP':
            new_head = (head_x, head_y - 1)
        elif self.direction == 'DOWN':
            new_head = (head_x, head_y + 1)
        elif self.direction == 'LEFT':
            new_head = (head_x - 1, head_y)
        elif self.direction == 'RIGHT':
            new_head = (head_x + 1, head_y)
        
        # Check for collisions with walls
        if (new_head[0] < 0 or new_head[0] >= self.width or 
            new_head[1] < 0 or new_head[1] >= self.height):
            self.game_over = True
            return
        
        # Check for collisions with itself
        if new_head in self.snake:
            self.game_over = True
            return
        
        # Add new head to snake
        self.snake.appendleft(new_head)
        
        # Check if snake ate food
        if new_head == self.food:
            self.score += 1
            self.food = self.generate_food()
        else:
            # Remove tail if no food eaten
            self.snake.pop()
    
    def get_game_grid(self):
        # Create empty grid
        grid = [[' ' for _ in range(self.width)] for _ in range(self.height)]
        
        # Place food
        food_x, food_y = self.food
        grid[food_y][food_x] = 'F'
        
        # Place snake
        for i, (x, y) in enumerate(self.snake):
            if i == 0:  # Head
                grid[y][x] = 'H'
            else:  # Body
                grid[y][x] = 'O'
        
        return grid
    
    def display(self):
        # Clear screen (works on both Windows and Unix-based systems)
        os.system('cls' if os.name == 'nt' else 'clear')
        
        # Display game grid
        grid = self.get_game_grid()
        print(f"Score: {self.score}")
        print("+" + "-" * self.width + "+")
        for row in grid:
            print("|" + ''.join(row) + "|")
        print("+" + "-" * self.width + "+")
        print("Use arrow keys to move. Press 'q' to quit.")
        
    def get_input(self):
        try:
            # Try to read input without blocking (non-blocking)
            if sys.platform == 'win32':
                import msvcrt
                if msvcrt.kbhit():
                    key = msvcrt.getch()
                    if key == b'q':
                        return 'QUIT'
                    elif key == b'H':  # Up arrow
                        if self.direction != 'DOWN':
                            self.direction = 'UP'
                    elif key == b'P':  # Down arrow
                        if self.direction != 'UP':
                            self.direction = 'DOWN'
                    elif key == b'K':  # Left arrow
                        if self.direction != 'RIGHT':
                            self.direction = 'LEFT'
                    elif key == b'M':  # Right arrow
                        if self.direction != 'LEFT':
                            self.direction = 'RIGHT'
            else:
                import tty, termios
                fd = sys.stdin.fileno()
                old_settings = termios.tcgetattr(fd)
                try:
                    tty.setraw(sys.stdin.fileno())
                    if sys.stdin in select.select([sys.stdin], [], [], 0)[0]:
                        ch = sys.stdin.read(1)
                        if ch == 'q':
                            return 'QUIT'
                        elif ch == '\x1b':  # Escape sequence
                            next_char = sys.stdin.read(1)
                            if next_char == '[':
                                direction_char = sys.stdin.read(1)
                                if direction_char == 'A':  # Up arrow
                                    if self.direction != 'DOWN':
                                        self.direction = 'UP'
                                elif direction_char == 'B':  # Down arrow
                                    if self.direction != 'UP':
                                        self.direction = 'DOWN'
                                elif direction_char == 'D':  # Left arrow
                                    if self.direction != 'RIGHT':
                                        self.direction = 'LEFT'
                                elif direction_char == 'C':  # Right arrow
                                    if self.direction != 'LEFT':
                                        self.direction = 'RIGHT'
                finally:
                    termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)
        except:
            # If we can't get input properly, continue without it
            pass
        
    def run(self):
        print("Welcome to Snake Game!")
        time.sleep(1)
        
        # Main game loop
        while not self.game_over:
            self.display()
            
            # Get input
            if self.get_input() == 'QUIT':
                break
            
            # Move snake
            self.move_snake()
            
            # Control game speed
            time.sleep(0.1)
        
        # Game over screen
        self.display()
        print(f"Game Over! Your score: {self.score}")
        print("Press any key to exit...")
        
        # Wait for user input before exiting
        if sys.platform == 'win32':
            import msvcrt
            msvcrt.getch()
        else:
            import tty, termios
            fd = sys.stdin.fileno()
            old_settings = termios.tcgetattr(fd)
            try:
                tty.setraw(sys.stdin.fileno())
                sys.stdin.read(1)
            finally:
                termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)

if __name__ == "__main__":
    game = SnakeGame()
    game.run()