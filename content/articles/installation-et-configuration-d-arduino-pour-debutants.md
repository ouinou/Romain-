---
title: 'Tutoriel : Installation et Configuration d''Arduino pour Débutants'
date: '2026-04-25'
category: Tutoriels
author: Équipe ITI
image: https://d2xsxph8kpxj0f.cloudfront.net/310519663472322953/SiZDkWCMs9VVpK9Ntbw4tM/iti-robotics-hGbaHosv7AGjrAbnapGrqm.webp
excerpt: Un guide complet pour installer et configurer votre première carte Arduino. Parfait pour les débutants en électronique.
published: true
---

Dans ce tutoriel, nous vous montrerons comment installer Arduino IDE, configurer votre première carte Arduino Uno, et télécharger votre premier programme.

## Étape 1 : Installation d'Arduino IDE

1. Visitez le site officiel d'Arduino (arduino.cc)
2. Téléchargez la version appropriée pour votre système d'exploitation
3. Installez l'application en suivant les instructions

## Étape 2 : Configuration de la Carte Arduino

1. Connectez votre Arduino Uno à votre ordinateur via un câble USB
2. Ouvrez Arduino IDE
3. Allez dans Tools > Board et sélectionnez "Arduino Uno"
4. Allez dans Tools > Port et sélectionnez le port COM approprié

## Étape 3 : Votre Premier Programme

Voici un programme simple qui fait clignoter la LED intégrée :

```cpp
void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(1000);
  digitalWrite(13, LOW);
  delay(1000);
}
```

Copiez ce code dans Arduino IDE et cliquez sur "Upload". Vous verrez la LED clignoter !

Félicitations ! Vous avez créé votre premier programme Arduino. À partir de là, vous pouvez explorer des projets plus complexes.
