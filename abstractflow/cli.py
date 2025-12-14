"""
Command-line interface for AbstractFlow.

This is a placeholder CLI that will be expanded in future versions.
"""

import sys
from typing import List, Optional


def main(args: Optional[List[str]] = None) -> int:
    """
    Main entry point for the AbstractFlow CLI.
    
    Args:
        args: Command-line arguments (defaults to sys.argv[1:])
        
    Returns:
        Exit code (0 for success, non-zero for error)
    """
    if args is None:
        args = sys.argv[1:]
    
    print("🚧 AbstractFlow CLI - Coming Soon!")
    print()
    print("AbstractFlow is currently in development.")
    print("This placeholder package reserves the PyPI name.")
    print()
    print("Planned CLI features:")
    print("  • abstractflow create <workflow>    - Create new workflow")
    print("  • abstractflow run <workflow>       - Execute workflow")
    print("  • abstractflow validate <workflow>  - Validate workflow")
    print("  • abstractflow export <workflow>    - Export workflow")
    print("  • abstractflow serve               - Start workflow server")
    print()
    print("Follow https://github.com/lpalbou/AbstractFlow for updates!")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())


