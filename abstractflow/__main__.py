"""
Main entry point for AbstractFlow when run as a module.

Usage: python -m abstractflow [args...]
"""

from .cli import main

if __name__ == "__main__":
    exit(main())


