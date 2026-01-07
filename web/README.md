# Minimal Snake Game

A simple terminal-based snake game implemented in Python using the curses library.

## Features
- Classic snake gameplay with growing snake when food is eaten
- Score tracking
- Game over on collision with walls or self
- Simple keyboard controls (arrow keys to change direction, 'q' to quit)

## Requirements
- Python 3.6+
- curses (built-in on Unix-like systems)

## How to Play
1. Run the game with: `python3 snake_game.py`
2. Use arrow keys to control the snake's direction
3. Eat the food (X) to grow and increase your score
4. Avoid hitting walls or yourself
5. Press 'q' to quit

## Game Mechanics
Based on the rules defined in `snake_game_rules.md`

## Running the Game
```bash
python3 snake_game.py
```

## Development
To install dependencies:
```bash
pip install -r requirements.txt
```

## License
MIT