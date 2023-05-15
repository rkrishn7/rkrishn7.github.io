---
layout: post
title: An Overview of Binary Encoding
subtitle: Isn't Everything Binary?
share-img: /assets/img/path.jpg
tags: [encoding, computing]
---

When I first heard the term "binary encoding", something just didn't click. Isn't all information ultimately represented as a sequence of bits? How can a file not be binary encoded? Before we start to panic and question our understanding of basic computing principles, we need a bit of context.

First, it is necessary to note that the physical representation of information is not related to how we digest it. In order to make that connection, we must have _context_. A sequence of bits can mean different things in different contexts. For example, let's examine the following byte sequence (depicted in hexadecimal notation):

```
66 25 21 21
```

In the context of printable ASCII characters, this byte sequence represents the string "fA%!!". However, in the context of x86-64 machine code, it represents the instruction `and ax,0x2121`. As a 32-bit unsigned big-endian integer, it is the value 1713709345.

The different interpretations of the information shown above illustrates this fantastic quote from [_Computer Systems: A Programmer's Perspective_](https://csapp.cs.cmu.edu/):

> ...All information in a system -- including disk files, programs stored in memory, user data stored in memory, and data transferred across a network -- is represented as a bunch of bits. The only thing that distinguishes different data objects is the context in which we view them. For example, in different contexts, the same sequence of bytes might represent an integer, floating-point number, character string, or machine instruction.

Now that we understand the importance of context when viewing data, what does it mean for something to be binary encoded? Well, it's really just an all-encompassing term for data that isn't human-readable, i.e. text data. When reading binary data, context is provided via instructions which decode the data into something meaningful. For example, [Protocol Buffers](https://protobuf.dev/overview/) is a widespread binary encoding library that provides a [reference](https://protobuf.dev/programming-guides/encoding/) for how it encodes data. Applications consuming this format must implement decoding schemes that adhere to the specification.

And that's it! I hope the term "binary encoding" is more clear, now that you have the context 😄.
