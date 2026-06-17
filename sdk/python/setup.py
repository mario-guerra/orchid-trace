import os
from setuptools import setup, find_packages

# Read the contents of README.md for the long description
sdk_dir = os.path.dirname(os.path.abspath(__file__))
readme_path = os.path.join(sdk_dir, "README.md")
long_description = ""
if os.path.exists(readme_path):
    with open(readme_path, "r", encoding="utf-8") as f:
        long_description = f.read()

setup(
    name="orchid-sdk",
    version="0.3.1",
    packages=find_packages(exclude=["tests", "tests.*"]),
    install_requires=[
        "httpx>=0.20.0",
    ],
    python_requires=">=3.8",
    description="Orchid Thin SDK for environment routing, transport patching, and proxy control",
    long_description=long_description,
    long_description_content_type="text/markdown",
    author="Orchid Team",
    author_email="team@orchid.dev",
    url="https://github.com/mario-guerra/orchid",
    license="Apache-2.0",
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: Apache Software License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Topic :: Software Development :: Debuggers",
        "Topic :: Software Development :: Testing",
    ],
)
