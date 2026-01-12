#!/usr/bin/env python3
"""
Setup script for AbstractFlow Web Application.
This file enables installation and packaging of the project.
"""

import os
from setuptools import setup, find_packages

# Read requirements from requirements.txt
here = os.path.abspath(os.path.dirname(__file__))
requirements_path = os.path.join(here, 'requirements.txt')

install_requires = []
if os.path.exists(requirements_path):
    with open(requirements_path, 'r') as f:
        for line in f:
            # Skip empty lines and comments
            line = line.strip()
            if line and not line.startswith('#'):
                install_requires.append(line)

setup(
    name="abstractflow-web",
    version="0.1.0",
    description="Web application for AbstractFlow framework.",
    long_description=open(os.path.join(here, 'README.md'), 'r').read() if os.path.exists(os.path.join(here, 'README.md')) else "Web application for AbstractFlow framework.",
    author="Your Name",
    author_email="your.email@example.com",
    packages=find_packages(),
    install_requires=install_requires,
    python_requires='>=3.7',
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.7",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
    ],
    entry_points={
        'console_scripts': [
            # Add command-line scripts here if needed
            # 'abstractflow-web=your_module.cli:main',
        ],
    },
)
